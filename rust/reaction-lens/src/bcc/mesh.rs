use super::{math::*, BccConfig};
use crate::pyrolysis::{invalid, Result};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
#[derive(Clone)]
pub struct Tet {
    pub nodes: [usize; 4],
    pub gradients: [V; 4],
    pub volume: f64,
}
#[derive(Clone)]
pub struct Face {
    pub nodes: [usize; 3],
    pub left: usize,
    pub right: Option<usize>,
    pub substrate: bool,
}
pub struct Mesh {
    pub nodes: Vec<V>,
    pub tets: Vec<Tet>,
    pub faces: Vec<Face>,
    pub fixed: Vec<bool>,
    pub volume: f64,
    pub h: f64,
}
impl Mesh {
    pub fn new(c: &BccConfig) -> Result<Self> {
        let n = c.cells_per_axis * c.voxels_per_cell;
        let h = 1. / c.voxels_per_cell as f64;
        let mut occupied = BTreeSet::new();
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    let p = [
                        (x as f64 + 0.5) * h,
                        (y as f64 + 0.5) * h,
                        (z as f64 + 0.5) * h,
                    ];
                    let cell = p.map(|v| v.floor());
                    let center = cell.map(|v| v + 0.5);
                    let inside = (0..8).any(|corner| {
                        let q = std::array::from_fn(|a| cell[a] + ((corner >> a) & 1) as f64);
                        let d = sub(q, center);
                        let t = (dot(sub(p, center), d) / dot(d, d)).clamp(0., 1.);
                        norm(sub(p, add(center, scale(d, t)))) <= c.strut_radius_ratio
                    });
                    if inside {
                        occupied.insert((x, y, z));
                    }
                }
            }
        }
        let start = *occupied
            .first()
            .ok_or_else(|| invalid("BCC mesh has no solid cells"))?;
        let mut seen = BTreeSet::from([start]);
        let mut queue = VecDeque::from([start]);
        while let Some((x, y, z)) = queue.pop_front() {
            for (dx, dy, dz) in [
                (1, 0, 0),
                (-1, 0, 0),
                (0, 1, 0),
                (0, -1, 0),
                (0, 0, 1),
                (0, 0, -1),
            ] {
                let q = (x as isize + dx, y as isize + dy, z as isize + dz);
                if q.0 >= 0 && q.1 >= 0 && q.2 >= 0 {
                    let q = (q.0 as usize, q.1 as usize, q.2 as usize);
                    if occupied.contains(&q) && seen.insert(q) {
                        queue.push_back(q);
                    }
                }
            }
        }
        if seen.len() != occupied.len() {
            return Err(invalid(
                "BCC struts are not face-connected at this resolution",
            ));
        }
        // Closed unresolved cavities may not be treated as an atmospheric sink.
        let mut air = BTreeSet::new();
        let mut aq = VecDeque::new();
        for z in 0..n {
            for y in 0..n {
                for x in 0..n {
                    if (x == 0
                        || y == 0
                        || (z == 0 && c.support == super::Support::Free)
                        || x == n - 1
                        || y == n - 1
                        || z == n - 1)
                        && !occupied.contains(&(x, y, z))
                    {
                        air.insert((x, y, z));
                        aq.push_back((x, y, z));
                    }
                }
            }
        }
        while let Some((x, y, z)) = aq.pop_front() {
            for (dx, dy, dz) in [
                (1, 0, 0),
                (-1, 0, 0),
                (0, 1, 0),
                (0, -1, 0),
                (0, 0, 1),
                (0, 0, -1),
            ] {
                let q = (x as isize + dx, y as isize + dy, z as isize + dz);
                if q.0 >= 0
                    && q.1 >= 0
                    && q.2 >= 0
                    && q.0 < n as isize
                    && q.1 < n as isize
                    && q.2 < n as isize
                {
                    let q = (q.0 as usize, q.1 as usize, q.2 as usize);
                    if !occupied.contains(&q) && air.insert(q) {
                        aq.push_back(q);
                    }
                }
            }
        }
        if air.len() + occupied.len() != n * n * n {
            return Err(invalid("closed architectural pores are unsupported"));
        }
        let mut nodes = Vec::new();
        let mut ids = BTreeMap::new();
        let mut tets = Vec::new();
        for &(x, y, z) in &occupied {
            let mut cube = [0usize; 8];
            for (corner, id) in cube.iter_mut().enumerate() {
                let q = (
                    x + (corner & 1),
                    y + ((corner >> 1) & 1),
                    z + ((corner >> 2) & 1),
                );
                *id = *ids.entry(q).or_insert_with(|| {
                    let i = nodes.len();
                    nodes.push([
                        q.0 as f64 * h - c.cells_per_axis as f64 / 2.,
                        q.1 as f64 * h - c.cells_per_axis as f64 / 2.,
                        q.2 as f64 * h,
                    ]);
                    i
                });
            }
            let reflection = (x % 2) | ((y % 2) << 1) | ((z % 2) << 2);
            for p in [
                [0, 1, 2],
                [0, 2, 1],
                [1, 0, 2],
                [1, 2, 0],
                [2, 0, 1],
                [2, 1, 0],
            ] {
                let corners = [0, 1 << p[0], (1 << p[0]) | (1 << p[1]), 7];
                let mut q = corners.map(|v| cube[v ^ reflection]);
                let mut dm = transpose([
                    sub(nodes[q[1]], nodes[q[0]]),
                    sub(nodes[q[2]], nodes[q[0]]),
                    sub(nodes[q[3]], nodes[q[0]]),
                ]);
                if det(dm) < 0. {
                    q.swap(1, 2);
                    dm = transpose([
                        sub(nodes[q[1]], nodes[q[0]]),
                        sub(nodes[q[2]], nodes[q[0]]),
                        sub(nodes[q[3]], nodes[q[0]]),
                    ]);
                }
                let inverse = inv(dm);
                let gradients = [
                    scale(add(add(inverse[0], inverse[1]), inverse[2]), -1.),
                    inverse[0],
                    inverse[1],
                    inverse[2],
                ];
                tets.push(Tet {
                    nodes: q,
                    gradients,
                    volume: det(dm) / 6.,
                });
            }
        }
        let mut fmap: BTreeMap<[usize; 3], Face> = BTreeMap::new();
        for (i, tet) in tets.iter().enumerate() {
            for local in [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]] {
                let face = local.map(|v| tet.nodes[v]);
                let mut key = face;
                key.sort();
                if let Some(f) = fmap.get_mut(&key) {
                    if f.right.is_some() {
                        return Err(invalid("nonmanifold tetrahedron face"));
                    }
                    f.right = Some(i);
                } else {
                    fmap.insert(
                        key,
                        Face {
                            nodes: face,
                            left: i,
                            right: None,
                            substrate: face.iter().all(|&j| nodes[j][2] == 0.),
                        },
                    );
                }
            }
        }
        let fixed = nodes
            .iter()
            .map(|p| c.support == super::Support::Bonded && p[2] == 0.)
            .collect();
        let volume = tets.iter().map(|t| t.volume).sum();
        Ok(Self {
            nodes,
            tets,
            faces: fmap.into_values().collect(),
            fixed,
            volume,
            h,
        })
    }
    pub fn deformation(&self, t: &Tet, x: &[V]) -> M {
        let mut f = [[0.; 3]; 3];
        for a in 0..4 {
            f = am(f, outer(x[t.nodes[a]], t.gradients[a]));
        }
        f
    }
    pub fn center(&self, t: &Tet, x: &[V]) -> V {
        scale(t.nodes.iter().fold([0.; 3], |v, &i| add(v, x[i])), 0.25)
    }
}
