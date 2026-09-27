// Isolate permanently rejected proof without dropping other signed events.
// A non-400 response is retained for retry; it must never count as delivery.
export async function drainProofBatch(events, { send, accepted, rejected }) {
  if (!events.length) return true;
  const status = await send(events);
  if (status >= 200 && status < 300) {
    await accepted(events);
    return true;
  }
  if (status !== 400) return false;
  if (events.length === 1) {
    await rejected(events[0]);
    return true;
  }
  const middle = Math.floor(events.length / 2);
  if (!await drainProofBatch(events.slice(0, middle), { send, accepted, rejected })) return false;
  return drainProofBatch(events.slice(middle), { send, accepted, rejected });
}
