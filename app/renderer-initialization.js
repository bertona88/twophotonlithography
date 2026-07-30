/**
 * Contain synchronous renderer construction failures so a missing graphics
 * context cannot escape a React effect and unmount the application.
 *
 * @template T
 * @param {() => T} initialize
 * @param {() => void} onUnavailable
 * @returns {T | null}
 */
export function initializeRenderer(initialize, onUnavailable) {
  try {
    return initialize();
  } catch {
    queueMicrotask(onUnavailable);
    return null;
  }
}
