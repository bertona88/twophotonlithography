/* tslint:disable */
/* eslint-disable */

/**
 * JavaScript-facing owner of the authoritative numerical state.
 */
export class ReactionLensSimulation {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Continue diffusion and chemistry with no optical source.
     */
    advance_dark_steps(step_count: number, progress: number): number;
    /**
     * Advance logical development steps, returning the count actually run.
     */
    advance_development_steps(step_count: number): number;
    /**
     * Advance illuminated fixed steps at a stationary trajectory progress.
     */
    advance_exposure_at_progress_steps(step_count: number, progress: number): number;
    /**
     * Advance exact fixed exposure steps, returning the count actually run.
     */
    advance_exposure_steps(step_count: number): number;
    /**
     * Return a small object with solver identity, schedule, time, checksum, and memory.
     */
    get_diagnostics(): any;
    /**
     * Refresh the packed snapshot and return its stable byte offset in Wasm memory.
     *
     * The worker must reacquire `wasm.memory.buffer`, create a `Float32Array`
     * view of `snapshot_len()` elements, and copy that view before transferring
     * an `ArrayBuffer` to the main thread.
     */
    get_snapshot(): number;
    /**
     * Construct from `{ exposureStepsTotal, parameters }` and an explicit seed.
     */
    constructor(config: any, seed: number);
    /**
     * Reset all fields and logical progress with a deterministic seed.
     */
    reset(seed: number): void;
    /**
     * Apply the current worker-derived exposure schedule.
     */
    set_exposure_steps_total(exposure_steps_total: number): void;
    /**
     * Apply validated parameters without implicitly resetting the state.
     */
    set_parameters(parameters: any): void;
    /**
     * Packed snapshot length in f32 elements (not bytes).
     */
    snapshot_len(): number;
}

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
    layer_positions_len(): number;
    constructor(config: any, occupancy: Uint8Array);
    reset(): void;
    scan_path_len(): number;
    set_parameters(parameters: any): void;
    snapshot_len(): number;
}

/**
 * Factory equivalent to `new ReactionLensSimulation(config, seed)`.
 */
export function create_simulation(config: any, seed: number): ReactionLensSimulation;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_reactionlenssimulation_free: (a: number, b: number) => void;
    readonly reactionlenssimulation_set_parameters: (a: number, b: number, c: number) => void;
    readonly reactionlenssimulation_set_exposure_steps_total: (a: number, b: number, c: number) => void;
    readonly reactionlenssimulation_reset: (a: number, b: number) => void;
    readonly reactionlenssimulation_advance_exposure_steps: (a: number, b: number) => number;
    readonly reactionlenssimulation_advance_exposure_at_progress_steps: (a: number, b: number, c: number, d: number) => void;
    readonly reactionlenssimulation_advance_dark_steps: (a: number, b: number, c: number, d: number) => void;
    readonly reactionlenssimulation_advance_development_steps: (a: number, b: number) => number;
    readonly reactionlenssimulation_get_snapshot: (a: number) => number;
    readonly reactionlenssimulation_snapshot_len: (a: number) => number;
    readonly reactionlenssimulation_get_diagnostics: (a: number, b: number) => void;
    readonly create_simulation: (a: number, b: number, c: number) => void;
    readonly __wbg_wholevolumesimulation_free: (a: number, b: number) => void;
    readonly wholevolumesimulation_new: (a: number, b: number, c: number, d: number) => void;
    readonly wholevolumesimulation_set_parameters: (a: number, b: number, c: number) => void;
    readonly wholevolumesimulation_reset: (a: number) => void;
    readonly wholevolumesimulation_advance_exposure_steps: (a: number, b: number) => number;
    readonly wholevolumesimulation_advance_development_steps: (a: number, b: number) => number;
    readonly wholevolumesimulation_get_snapshot: (a: number) => number;
    readonly wholevolumesimulation_snapshot_len: (a: number) => number;
    readonly wholevolumesimulation_get_scan_path: (a: number) => number;
    readonly wholevolumesimulation_scan_path_len: (a: number) => number;
    readonly wholevolumesimulation_get_layer_positions: (a: number) => number;
    readonly wholevolumesimulation_layer_positions_len: (a: number) => number;
    readonly wholevolumesimulation_focus: (a: number, b: number) => void;
    readonly wholevolumesimulation_exposure_progress: (a: number) => number;
    readonly wholevolumesimulation_development_progress: (a: number) => number;
    readonly wholevolumesimulation_get_diagnostics: (a: number, b: number) => void;
    readonly reactionlenssimulation_new: (a: number, b: number, c: number) => void;
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
