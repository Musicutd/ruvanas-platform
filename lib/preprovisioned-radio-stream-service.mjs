import { resolveEntitlements } from "./entitlements.mjs";
import { planPreprovisionedRadioStream } from "./preprovisioned-radio-stream.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export class PreprovisionedRadioStreamError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreprovisionedRadioStreamError";
    this.code = code;
  }
}

/**
 * Claims one verified, pre-existing provider account for an Online Radio
 * station. This does not call Centova, create a channel or enable output.
 * The caller is responsible for authorization and for adding verified slots
 * to the inventory through a separate, secure administrative workflow.
 */
export async function claimPreprovisionedRadioStream(database, { stationId, actorUserId = null, now = new Date() }) {
  if (typeof stationId !== "string" || !stationId.trim()) throw new PreprovisionedRadioStreamError("STATION_ID_REQUIRED");
  const claimedAt = new Date(now);
  if (Number.isNaN(claimedAt.getTime())) throw new PreprovisionedRadioStreamError("INVALID_CLAIM_TIME");

  async function attempt() {
    return runSerializableTransaction(database, async (tx) => {
      const station = await tx.station.findUnique({
        where: { id: stationId },
        select: {
          id: true, organisationId: true, productFamily: true, status: true,
          listenerLimit: true, maxBitrateKbps: true, providerAccountId: true,
          streamConfig: { select: { id: true } },
          organisation: { select: { subscription: { include: { plan: true, billingContract: true } } } }
        }
      });
      if (!station) throw new PreprovisionedRadioStreamError("STATION_NOT_FOUND");
      if (station.status !== "PENDING_SETUP") throw new PreprovisionedRadioStreamError("STATION_NOT_PENDING_SETUP");
      const entitlements = resolveEntitlements(station.organisation.subscription);
      if (!entitlements.onlineRadioEnabled) throw new PreprovisionedRadioStreamError("ONLINE_RADIO_NOT_ENTITLED");
      if (station.listenerLimit > entitlements.listenerLimit || station.maxBitrateKbps > entitlements.maxBitrateKbps) {
        throw new PreprovisionedRadioStreamError("STATION_LIMIT_EXCEEDS_ENTITLEMENT");
      }

      const [slots, occupiedConfigs] = await Promise.all([
        tx.preprovisionedRadioStream.findMany({
          where: { status: "AVAILABLE" },
          select: {
            id: true, providerKey: true, centovaUsername: true, streamUrl: true,
            serverHost: true, serverPort: true, sourcePort: true, sourceUsername: true,
            sourcePasswordEncrypted: true, listenerLimit: true, maxBitrateKbps: true,
            status: true, verifiedAt: true, stationId: true
          }
        }),
        tx.stationStreamConfig.findMany({
          where: { providerKey: "CENTOVA_CAST" },
          select: { centovaUsername: true, streamUrl: true, serverHost: true, sourcePort: true }
        })
      ]);
      const plan = planPreprovisionedRadioStream({ station, slots, occupiedConfigs });
      if (!plan.ready) throw new PreprovisionedRadioStreamError(plan.reason);
      const slot = slots.find((item) => item.id === plan.slotId);
      const claimed = await tx.preprovisionedRadioStream.updateMany({
        where: { id: slot.id, status: "AVAILABLE", stationId: null },
        data: { status: "CLAIMED", stationId: station.id, claimedAt }
      });
      if (claimed.count !== 1) throw new PreprovisionedRadioStreamError("STREAM_SLOT_RACE");

      await tx.stationStreamConfig.create({
        data: {
          stationId: station.id,
          providerKey: "CENTOVA_CAST",
          centovaUsername: slot.centovaUsername,
          streamUrl: slot.streamUrl,
          serverHost: slot.serverHost,
          serverPort: slot.serverPort,
          sourcePort: slot.sourcePort,
          sourceUsername: slot.sourceUsername,
          sourcePasswordEncrypted: slot.sourcePasswordEncrypted,
          bitrateKbps: station.maxBitrateKbps,
          outboundAutoDjEnabled: false,
          probeEnabled: true,
          probeIntervalSeconds: 300,
          probeTimeoutMs: 8_000
        }
      });
      await tx.station.update({
        where: { id: station.id },
        data: { providerName: "Centova Cast", providerAccountId: slot.centovaUsername }
      });
      await tx.auditLog.create({
        data: {
          organisationId: station.organisationId,
          actorUserId,
          action: "ONLINE_RADIO_STREAM_SLOT_CLAIMED",
          entityType: "Station",
          entityId: station.id,
          details: { slotId: slot.id, automated: !actorUserId, outboundAutoDjEnabled: false }
        }
      });
      return { stationId: station.id, slotId: slot.id, outboundAutoDjEnabled: false };
    });
  }

  for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (error?.code !== "STREAM_SLOT_RACE" || attemptNumber === 2) throw error;
    }
  }
  throw new PreprovisionedRadioStreamError("STREAM_SLOT_RACE");
}
