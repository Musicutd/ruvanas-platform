import { encryptSecret } from "./crypto.js";
import { normalizePreprovisionedRadioStreamInput } from "./preprovisioned-radio-stream.mjs";
import { runSerializableTransaction } from "./transaction-retry.mjs";

export class RadioStreamRegistrationError extends Error {
  constructor(code) {
    super(code);
    this.name = "RadioStreamRegistrationError";
    this.code = code;
  }
}

function canonicalUrl(value) {
  try { return new URL(value).href; } catch { return String(value || ""); }
}

function sameSource(left, right) {
  return String(left?.serverHost || "").toLowerCase().replace(/\.$/, "") === right.serverHost &&
    Number(left?.sourcePort) === right.sourcePort;
}

/**
 * Records an externally provisioned account, but never makes it claimable.
 * This is an intake operation, not a provider-account or listener verification.
 */
export async function registerPreprovisionedRadioStream(database, { input, actorUserId }) {
  if (!actorUserId) throw new RadioStreamRegistrationError("ACTOR_REQUIRED");
  let normalized;
  try {
    normalized = normalizePreprovisionedRadioStreamInput(input);
  } catch {
    throw new RadioStreamRegistrationError("INVALID_STREAM_SLOT");
  }
  const { sourcePassword, ...safeFields } = normalized;
  const sourcePasswordEncrypted = encryptSecret(sourcePassword);

  return runSerializableTransaction(database, async (tx) => {
    const [inventory, occupiedConfigs, assignedStations] = await Promise.all([
      tx.preprovisionedRadioStream.findMany({
        select: { centovaUsername: true, streamUrl: true, serverHost: true, sourcePort: true }
      }),
      tx.stationStreamConfig.findMany({
        where: { providerKey: "CENTOVA_CAST" },
        select: { centovaUsername: true, streamUrl: true, serverHost: true, sourcePort: true }
      }),
      tx.station.findMany({
        where: { providerAccountId: { not: null } },
        select: { providerAccountId: true }
      })
    ]);
    const account = safeFields.centovaUsername.toLowerCase();
    if ([...inventory, ...occupiedConfigs].some((row) =>
      String(row.centovaUsername || "").toLowerCase() === account ||
      canonicalUrl(row.streamUrl) === safeFields.streamUrl || sameSource(row, safeFields)
    ) || assignedStations.some((station) => String(station.providerAccountId || "").toLowerCase() === account)) {
      throw new RadioStreamRegistrationError("STREAM_SLOT_ALREADY_USED");
    }

    const slot = await tx.preprovisionedRadioStream.create({
      data: {
        ...safeFields,
        sourcePasswordEncrypted,
        status: "QUARANTINED",
        verifiedAt: null,
        stationId: null,
        claimedAt: null
      },
      select: {
        id: true, centovaUsername: true, streamUrl: true, serverHost: true,
        serverPort: true, sourcePort: true, listenerLimit: true,
        maxBitrateKbps: true, status: true
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "ONLINE_RADIO_STREAM_SLOT_REGISTERED",
        entityType: "PreprovisionedRadioStream",
        entityId: slot.id,
        details: {
          providerKey: safeFields.providerKey,
          listenerLimit: safeFields.listenerLimit,
          maxBitrateKbps: safeFields.maxBitrateKbps,
          status: "QUARANTINED"
        }
      }
    });
    return slot;
  });
}
