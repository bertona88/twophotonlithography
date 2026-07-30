const INTERACTIVE_TARGETS =
  "button, input, textarea, select, a[href], [contenteditable], [role='button'], [role='link']";

export function shouldIgnoreLabShortcut(event) {
  const target = event.target;
  const interactiveTarget =
    target &&
    typeof target.closest === "function" &&
    target.closest(INTERACTIVE_TARGETS);

  return Boolean(
    event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      interactiveTarget,
  );
}
