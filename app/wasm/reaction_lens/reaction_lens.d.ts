/* tslint:disable */
/* eslint-disable */

/**
 * JavaScript-facing owner of the adaptive dense 3D resin volume.
 */
export class WholeVolumeSimulation {
    free(): void;
    [Symbol.dispose](): void;
    advance_development_steps(step_count: number): number;
    advance_exposure_steps(step_count: number): number;
    development_progress(): number;
    exposure_progress(): number;
    focus(): Float32Array;
    get_cached_diagnostics(): any;
    get_diagnostics(): any;
    /**
     * Physical Z coordinate of every emitted scan layer (f32 elements).
     */
    get_layer_positions(): number;
    /**
     * Packed illuminated line segments in XYZXYZ order (f32 elements).
     */
    get_scan_path(): number;
    get_snapshot(): number;
    /**
     * Packed oxygen, radicals, conversion, remaining mass, and occupancy for
     * the authoritative XY grid plane nearest the requested physical Z.
     */
    get_xy_slice(z_um: number): number;
    layer_positions_len(): number;
    constructor(config: any, occupancy: Uint8Array);
    reset(): void;
    scan_path_len(): number;
    set_parameters(parameters: any): void;
    snapshot_len(): number;
    xy_slice_height(): number;
    xy_slice_len(): number;
    xy_slice_width(): number;
    xy_slice_z_um(): number;
}

/**
 * Compute a renderable PSF envelope from the same adaptive Debye kernel used
 * by the 3D simulation, without constructing or mutating simulation state.
 */
export function preview_volume_psf(na: number, wavelength_nm: number, memory_budget_bytes: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly preview_volume_psf: (a: number, b: number, c: number, d: number) => void;
    readonly __wbg_wholevolumesimulation_free: (a: number, b: number) => void;
    readonly wholevolumesimulation_new: (a: number, b: number, c: number, d: number) => void;
    readonly wholevolumesimulation_set_parameters: (a: number, b: number, c: number) => void;
    readonly wholevolumesimulation_reset: (a: number) => void;
    readonly wholevolumesimulation_advance_exposure_steps: (a: number, b: number) => number;
    readonly wholevolumesimulation_advance_development_steps: (a: number, b: number) => number;
    readonly wholevolumesimulation_get_snapshot: (a: number) => number;
    readonly wholevolumesimulation_snapshot_len: (a: number) => number;
    readonly wholevolumesimulation_get_xy_slice: (a: number, b: number) => number;
    readonly wholevolumesimulation_xy_slice_len: (a: number) => number;
    readonly wholevolumesimulation_xy_slice_width: (a: number) => number;
    readonly wholevolumesimulation_xy_slice_height: (a: number) => number;
    readonly wholevolumesimulation_xy_slice_z_um: (a: number) => number;
    readonly wholevolumesimulation_get_scan_path: (a: number) => number;
    readonly wholevolumesimulation_scan_path_len: (a: number) => number;
    readonly wholevolumesimulation_get_layer_positions: (a: number) => number;
    readonly wholevolumesimulation_layer_positions_len: (a: number) => number;
    readonly wholevolumesimulation_focus: (a: number, b: number) => void;
    readonly wholevolumesimulation_exposure_progress: (a: number) => number;
    readonly wholevolumesimulation_development_progress: (a: number) => number;
    readonly wholevolumesimulation_get_diagnostics: (a: number, b: number) => void;
    readonly wholevolumesimulation_get_cached_diagnostics: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
