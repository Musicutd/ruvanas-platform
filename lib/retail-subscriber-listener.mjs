import { isRetailSubscriberContext, resolveRetailSubscriberWorkspace,
  RETAIL_SUBSCRIBER_STATION_ID } from "./retail-subscriber-access.mjs";
import { loadSubscriberAuthorizedRetailListener, RetailPlayoutError } from "./retail-stream-playout-service.mjs";

/** Only an existing signed-in Retail pilot may reveal its already-approved
 * listener. Ordinary managed drafts retain their generic lifecycle fence. */
export async function loadRetailSubscriberListener(db, context, { now = new Date(), env = process.env } = {}) {
  if (!isRetailSubscriberContext(context, now)) return null;
  const workspace = await resolveRetailSubscriberWorkspace(db, context, { now });
  if (!workspace || workspace.stationId !== RETAIL_SUBSCRIBER_STATION_ID) return null;
  try {
    return await loadSubscriberAuthorizedRetailListener(db, context, { now, env });
  } catch (error) {
    if (error instanceof RetailPlayoutError) return null;
    throw error;
  }
}
