import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { normaliseGenreCode } from "./autodj-genre-entitlements.mjs";

export const RETAIL_PLAYOUT = Object.freeze({ kind: "RETAIL_SHARED_PLAYOUT_V1", leaseSeconds: 45, takeoverGraceSeconds: 20,
  observationFreshnessMs: 15000, wireMultiplier: 1.05, maximumReservationBytes: 2 * 1024 * 1024,
  maximumAssignments: 500, maximumCandidates: 5000, reservedStationId: "cmvcnbwi20008hr23sd76psi8" });
export class RetailPlayoutError extends Error {
  constructor(reason, status = 409) { super(`Retail playout is unavailable: ${reason}.`); this.name = "RetailPlayoutError";
    this.code = `RETAIL_PLAYOUT_${reason}`; this.status = status; }
}
export const retailPlayoutFail = (reason, status) => { throw new RetailPlayoutError(reason, status); };
export const retailPlayoutId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const fields = new Set(["organisationId", "stationId", "workerId", "slot", "monthlyBudgetUsd", "monthlyComputeUsd", "monthlyOtherReserveUsd", "bandwidthUsdPerGB", "maxBitrateKbps"]);
const reservedWorker = value => /test[-_]?radio|radio[-_]?test|srv-damhnbv40ujc73b00lgg/i.test(value);
const canonical = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const retailPlayoutFingerprint = value => createHash("sha256").update(canonical(value)).digest("hex");

/** Operator-owned assignments only. This parser never provisions a resource. */
export function retailCapacityAssignments(env = process.env) {
  if (!env.RUVANAS_RETAIL_CAPACITY) return [];
  let rows; try { rows = JSON.parse(env.RUVANAS_RETAIL_CAPACITY); } catch { retailPlayoutFail("CAPACITY_INVALID"); }
  if (!Array.isArray(rows) || rows.length > RETAIL_PLAYOUT.maximumAssignments) retailPlayoutFail("CAPACITY_INVALID");
  const organisations = new Set(), stations = new Set(), slots = new Set();
  return rows.map(row => {
    if (!record(row) || Object.keys(row).some(key => !fields.has(key)) || [...fields].some(key => !Object.hasOwn(row, key)) ||
        !retailPlayoutId(row.organisationId) || !retailPlayoutId(row.stationId) || row.stationId === RETAIL_PLAYOUT.reservedStationId ||
        typeof row.workerId !== "string" || !/^[A-Za-z0-9_-]{3,100}$/.test(row.workerId) || reservedWorker(row.workerId) ||
        !["string", "number"].includes(typeof row.slot) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(row.slot)) ||
        !Number.isInteger(row.maxBitrateKbps) || row.maxBitrateKbps < 8 || row.maxBitrateKbps > 320 ||
        !Number.isFinite(row.monthlyBudgetUsd) || row.monthlyBudgetUsd <= 0 || row.monthlyBudgetUsd > 10000 ||
        !Number.isFinite(row.monthlyComputeUsd) || row.monthlyComputeUsd < 0 ||
        !Number.isFinite(row.monthlyOtherReserveUsd) || row.monthlyOtherReserveUsd < 0 ||
        !Number.isFinite(row.bandwidthUsdPerGB) || row.bandwidthUsdPerGB <= 0 ||
        row.monthlyComputeUsd + row.monthlyOtherReserveUsd >= row.monthlyBudgetUsd) retailPlayoutFail("CAPACITY_INVALID");
    const slot = `${row.workerId}:${row.slot}`;
    if (organisations.has(row.organisationId) || stations.has(row.stationId) || slots.has(slot)) retailPlayoutFail("CAPACITY_CONFLICT");
    organisations.add(row.organisationId); stations.add(row.stationId); slots.add(slot);
    return Object.freeze({ ...row, slot: String(row.slot) });
  });
}
export function retailCapacityAssignment(env, { organisationId, stationId, workerId } = {}) {
  const row = retailCapacityAssignments(env).find(item => item.organisationId === organisationId && item.stationId === stationId);
  if (!row || workerId !== undefined && row.workerId !== workerId) retailPlayoutFail("CAPACITY_NOT_ASSIGNED");
  return row;
}
/** Pre-approved hosting capacity, configured once by the operator. Slot counts
 * are assertions of available capacity, never instructions to create workers. */
export function retailCapacityPools(env = process.env) {
  if (!env.RUVANAS_RETAIL_POOL) return [];
  let rows; try { rows = JSON.parse(env.RUVANAS_RETAIL_POOL); } catch { retailPlayoutFail("CAPACITY_INVALID"); }
  if (!Array.isArray(rows) || rows.length > 50) retailPlayoutFail("CAPACITY_INVALID");
  const workers = new Set(retailCapacityAssignments(env).map(row => row.workerId));
  return rows.map(row => {
    const allowed = ["workerId", "slots", "monthlyBudgetUsd", "monthlyComputeUsd", "monthlyOtherReserveUsd", "bandwidthUsdPerGB", "maxBitrateKbps"];
    if (!record(row) || Object.keys(row).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(row, key)) ||
        !Number.isInteger(row.slots) || row.slots < 1 || row.slots > 4) retailPlayoutFail("CAPACITY_INVALID");
    if (workers.has(row.workerId)) retailPlayoutFail("CAPACITY_CONFLICT");
    const { slots, ...limits } = row;
    retailCapacityAssignments({ RUVANAS_RETAIL_CAPACITY: JSON.stringify([{ ...limits, organisationId: "validation-org", stationId: "validation-station", slot: "pool-1" }]) });
    workers.add(row.workerId); return Object.freeze({ ...limits, slots });
  });
}
export function retailSourceFingerprint(source) {
  return retailPlayoutFingerprint(Object.fromEntries(["stationId", "providerKey", "streamUrl", "serverHost", "serverPort", "sourcePort",
    "sourceUsername", "centovaUsername", "bitrateKbps", "outputCodec", "serverType", "sampleRateHz", "outputChannels",
    "sourcePasswordEncrypted", "outboundAutoDjEnabled", "probeEnabled"].map(key => [key, source?.[key] ?? null])));
}
export function retailProgrammeInput({ territory, genreCodes } = {}) {
  if (typeof territory !== "string" || !/^[A-Z]{2}$/.test(territory) || !Array.isArray(genreCodes) || genreCodes.length > 100 ||
      genreCodes.some(code => typeof code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(code)) || new Set(genreCodes.map(normaliseGenreCode)).size !== genreCodes.length)
    retailPlayoutFail("PROGRAMME_INVALID", 400);
  return { territory, genreCodes: genreCodes.map(normaliseGenreCode).sort(), requiredUse: "RETAIL_RADIO", mode: "RANDOM" };
}
export function retailTrackFingerprint(track) {
  const media = track?.mediaAsset;
  return retailPlayoutFingerprint({ id: track?.id, assetId: media?.id, storageKey: media?.storageKey, checksumSha256: media?.checksumSha256,
    sizeBytes: media?.sizeBytes, mediaStatus: media?.status, durationSeconds: media?.durationSeconds, status: track?.status, rightsReviewStatus: track?.rightsReviewStatus,
    permittedUses: track?.permittedUses, permittedTerritories: track?.permittedTerritories, catalogueProvider: track?.catalogueProvider,
    licenceStartsAt: track?.licenceStartsAt, licenceExpiresAt: track?.licenceExpiresAt, minimumCatalogueLevel: track?.minimumCatalogueLevel,
    rightsConfirmedAt: track?.rightsConfirmedAt, rightsHolder: track?.rightsHolder, rightsBasis: track?.rightsBasis,
    rightsReference: track?.rightsReference, distributorItems: track?.distributorItems });
}
function signingKey(env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.SECRET_ENCRYPTION_KEY || "")) retailPlayoutFail("SIGNING_UNAVAILABLE");
  return createHmac("sha256", Buffer.from(env.SECRET_ENCRYPTION_KEY, "hex")).update("ruvanas/retail-playout/v1").digest();
}
export const signRetailPlayoutCommand = (command, env = process.env) => createHmac("sha256", signingKey(env)).update(canonical(command)).digest("hex");
export function verifyRetailPlayoutCommand(envelope, env = process.env) {
  try { return typeof envelope?.signature === "string" && /^[a-f0-9]{64}$/.test(envelope.signature) &&
    timingSafeEqual(Buffer.from(envelope.signature, "hex"), Buffer.from(signRetailPlayoutCommand(envelope.command, env), "hex")); } catch { return false; }
}
export function retailBudgetMonth(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) retailPlayoutFail("TIME_INVALID", 400);
  return now.toISOString().slice(0, 7);
}
export function retailBudget(assignment, bitrateKbps) {
  const availableUsd = assignment.monthlyBudgetUsd - assignment.monthlyComputeUsd - assignment.monthlyOtherReserveUsd;
  return { monthlyBudgetUsd: assignment.monthlyBudgetUsd, maximumChargedBytes: Math.floor(availableUsd / assignment.bandwidthUsdPerGB * 1e9),
    estimatedMonthlyUsd: Number((assignment.monthlyComputeUsd + assignment.monthlyOtherReserveUsd +
      bitrateKbps * 1000 / 8 * 86400 * 31 * RETAIL_PLAYOUT.wireMultiplier / 1e9 * assignment.bandwidthUsdPerGB).toFixed(2)),
    wireMultiplier: RETAIL_PLAYOUT.wireMultiplier };
}
export function retailChargedBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > RETAIL_PLAYOUT.maximumReservationBytes) retailPlayoutFail("RESERVATION_INVALID", 400);
  return Math.ceil(bytes * RETAIL_PLAYOUT.wireMultiplier);
}
