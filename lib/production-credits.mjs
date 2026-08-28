export const PRODUCTION_CREDIT_ENTRY_TYPES = Object.freeze([
  "GRANT",
  "PURCHASE",
  "RESERVE",
  "CONSUME",
  "RELEASE",
  "EXPIRY",
  "ADJUSTMENT"
]);

export function creditMovement(entryType, quantity) {
  const type = String(entryType || "").toUpperCase();
  const amount = Number(quantity);
  if (!PRODUCTION_CREDIT_ENTRY_TYPES.includes(type)) throw new Error("Choose a valid production-credit entry type.");
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) throw new Error("Credit quantity must be a non-zero whole number.");
  if (type !== "ADJUSTMENT" && amount < 1) throw new Error("Credit quantity must be a positive whole number.");

  if (type === "GRANT" || type === "PURCHASE") return { availableDelta: amount, reservedDelta: 0 };
  if (type === "RESERVE") return { availableDelta: -amount, reservedDelta: amount };
  if (type === "CONSUME") return { availableDelta: 0, reservedDelta: -amount };
  if (type === "RELEASE") return { availableDelta: amount, reservedDelta: -amount };
  if (type === "EXPIRY") return { availableDelta: -amount, reservedDelta: 0 };
  return { availableDelta: amount, reservedDelta: 0 };
}

export function nextCreditBalance({ available = 0, reserved = 0, entryType, quantity }) {
  const movement = creditMovement(entryType, quantity);
  const availableAfter = Number(available) + movement.availableDelta;
  const reservedAfter = Number(reserved) + movement.reservedDelta;
  if (availableAfter < 0) throw new Error("There are not enough available production credits for this entry.");
  if (reservedAfter < 0) throw new Error("There are not enough reserved production credits for this entry.");
  return { ...movement, availableAfter, reservedAfter };
}

export function fundingAllowsProduction(fundingStatus) {
  return new Set(["RESERVED", "LEGACY_UNMETERED"]).has(String(fundingStatus || ""));
}

export function fundingAllowsDelivery(fundingStatus) {
  return fundingAllowsProduction(fundingStatus);
}


