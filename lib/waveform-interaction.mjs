export function waveformTimeAtPointer(clientX, left, width, durationMs) {
  const usableWidth = Number(width);
  const duration = Number(durationMs);
  if (!(usableWidth > 0) || !(duration > 0)) return 0;
  const fraction = Math.min(1, Math.max(0, (Number(clientX) - Number(left)) / usableWidth));
  return Math.round(fraction * duration);
}

export function waveformDragSelection(anchorMs, currentMs) {
  return { startMs: Math.min(anchorMs, currentMs), endMs: Math.max(anchorMs, currentMs) };
}
