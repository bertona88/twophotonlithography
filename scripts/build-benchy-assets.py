#!/usr/bin/env python3
"""Build deterministic browser assets from the official binary 3DBenchy STL."""

from __future__ import annotations

import argparse
import json
import math
import struct
from collections import deque
from pathlib import Path

import numpy as np


GRID = (128, 72, 104)
TARGET_LENGTH_UM = 22.0
TARGET_Z0_UM = 0.18
MAX_RENDER_TRIANGLES = 80_000


def read_binary_stl(path: Path) -> np.ndarray:
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError("STL is too small")
    count = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + count * 50
    if len(data) != expected:
        raise ValueError(f"expected {expected} STL bytes, found {len(data)}")
    records = np.frombuffer(data, dtype=np.dtype([
        ("normal", "<f4", (3,)),
        ("vertices", "<f4", (9,)),
        ("attribute", "<u2"),
    ]), offset=84, count=count)
    return records["vertices"].reshape(-1, 3, 3).astype(np.float64)


def normalized_triangles(triangles: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    low = triangles.reshape(-1, 3).min(axis=0)
    high = triangles.reshape(-1, 3).max(axis=0)
    scale = TARGET_LENGTH_UM / (high[0] - low[0])
    scaled = (triangles - low) * scale
    scaled[..., 0] -= (high[0] - low[0]) * scale * 0.5
    scaled[..., 1] -= (high[1] - low[1]) * scale * 0.5
    scaled[..., 2] += TARGET_Z0_UM
    return scaled, low, high


def triangle_areas(triangles: np.ndarray) -> np.ndarray:
    return np.linalg.norm(
        np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]),
        axis=1,
    ) * 0.5


def select_render_triangles(triangles: np.ndarray) -> np.ndarray:
    if len(triangles) <= MAX_RENDER_TRIANGLES:
        return triangles
    areas = triangle_areas(triangles)
    # Preserve every large feature and distribute the remainder over the source
    # order. STL source order is deterministic, so the asset checksum is stable.
    large_count = MAX_RENDER_TRIANGLES // 3
    large = np.argpartition(areas, -large_count)[-large_count:]
    remaining = np.setdiff1d(np.arange(len(triangles)), large, assume_unique=False)
    step = len(remaining) / (MAX_RENDER_TRIANGLES - large_count)
    distributed = remaining[(np.arange(MAX_RENDER_TRIANGLES - large_count) * step).astype(int)]
    selected = np.unique(np.concatenate([large, distributed]))
    if len(selected) > MAX_RENDER_TRIANGLES:
        selected = selected[:MAX_RENDER_TRIANGLES]
    return triangles[np.sort(selected)]


def rasterize_surface(triangles: np.ndarray, bounds_low: np.ndarray, bounds_high: np.ndarray) -> np.ndarray:
    nx, ny, nz = GRID
    surface = np.zeros((nx, ny, nz), dtype=np.bool_)
    pitch = (bounds_high - bounds_low) / np.array([nx - 5, ny - 5, nz - 5])
    origin = bounds_low - pitch * 2

    for triangle in triangles:
        grid_triangle = (triangle - origin) / pitch
        edge = max(
            np.linalg.norm(grid_triangle[1] - grid_triangle[0]),
            np.linalg.norm(grid_triangle[2] - grid_triangle[1]),
            np.linalg.norm(grid_triangle[0] - grid_triangle[2]),
        )
        subdivisions = max(1, min(48, int(math.ceil(edge * 1.5))))
        for i in range(subdivisions + 1):
            for j in range(subdivisions + 1 - i):
                u = i / subdivisions
                v = j / subdivisions
                point = triangle[0] * (1 - u - v) + triangle[1] * u + triangle[2] * v
                cell = np.rint((point - origin) / pitch).astype(int)
                if np.all(cell >= 0) and cell[0] < nx and cell[1] < ny and cell[2] < nz:
                    surface[tuple(cell)] = True

    # One-cell closing makes the sampled triangle skin 6-connected before the
    # exterior flood fill. This is conservative at the voxel scale.
    closed = surface.copy()
    for axis in range(3):
        closed |= np.roll(surface, 1, axis=axis)
        closed |= np.roll(surface, -1, axis=axis)
    closed[[0, -1], :, :] = False
    closed[:, [0, -1], :] = False
    closed[:, :, [0, -1]] = False
    return closed, origin, pitch


def fill_interior(surface: np.ndarray) -> np.ndarray:
    nx, ny, nz = surface.shape
    outside = np.zeros_like(surface)
    queue: deque[tuple[int, int, int]] = deque([(0, 0, 0)])
    outside[0, 0, 0] = True
    while queue:
        x, y, z = queue.popleft()
        for dx, dy, dz in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            xx, yy, zz = x + dx, y + dy, z + dz
            if 0 <= xx < nx and 0 <= yy < ny and 0 <= zz < nz and not surface[xx, yy, zz] and not outside[xx, yy, zz]:
                outside[xx, yy, zz] = True
                queue.append((xx, yy, zz))
    return ~outside


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stl", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = read_binary_stl(args.stl)
    scaled, source_low, source_high = normalized_triangles(source)
    low = scaled.reshape(-1, 3).min(axis=0)
    high = scaled.reshape(-1, 3).max(axis=0)
    surface, origin, pitch = rasterize_surface(scaled, low, high)
    occupancy = fill_interior(surface)
    render = select_render_triangles(scaled).astype("<f4")

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "3dbenchy-mesh.bin").write_bytes(render.tobytes(order="C"))
    # Rust uses x-major indexing: x + nx * (y + ny * z).
    packed_occupancy = np.transpose(occupancy, (2, 1, 0)).astype(np.uint8).ravel(order="C")
    (args.output / "3dbenchy-occupancy.bin").write_bytes(packed_occupancy.tobytes())
    metadata = {
        "source": "https://github.com/CreativeTools/3DBenchy/blob/b542785f9642ab39db8a778a0ccc934b3ebd829a/Single-part/3DBenchy.stl",
        "sourceBoundsMm": {"min": source_low.tolist(), "max": source_high.tolist()},
        "boundsUm": {"min": low.tolist(), "max": high.tolist()},
        "grid": list(GRID),
        "originUm": origin.tolist(),
        "pitchUm": pitch.tolist(),
        "sourceTriangles": int(len(source)),
        "renderTriangles": int(len(render)),
        "occupiedVoxels": int(occupancy.sum()),
    }
    (args.output / "3dbenchy-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
