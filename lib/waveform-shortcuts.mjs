export function waveformPrimaryShortcut(event, { visible, canEdit, hasSelection } = {}) {
  if (!visible) return null;
  const key = String(event.key || "").toLowerCase();
  const target = event.target;
  const tag = String(target?.tagName || "").toUpperCase();
  const textField = ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || target?.isContentEditable;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === "s") {
    return canEdit && !event.repeat ? "SAVE" : null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || textField) return null;
  if (event.code === "Space" && tag !== "BUTTON" && !event.repeat) return "PLAY_PAUSE";
  if (key === "delete" && canEdit && hasSelection) return event.shiftKey ? "DELETE_KEEP_GAP" : "DELETE_SELECTION";
  return null;
}
