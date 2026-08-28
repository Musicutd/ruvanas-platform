import { nextCreditBalance } from "./production-credits.mjs";

function cleanOptional(value, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > maximum) throw new Error("Production-credit reference text is too long.");
  return text;
}

export async function appendProductionCreditEntry(tx, {
  organisationId,
  orderId = null,
  actorUserId = null,
  entryType,
  quantity,
  idempotencyKey,
  externalReference = null,
  note = null,
  expiresAt = null
}) {
  const key = cleanOptional(idempotencyKey, 190);
  if (!key) throw new Error("A production-credit idempotency key is required.");

  const existing = await tx.productionCreditLedgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.organisationId !== organisationId) throw new Error("This production-credit request conflicts with another organisation.");
    return existing;
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))`;
  const afterLock = await tx.productionCreditLedgerEntry.findUnique({ where: { idempotencyKey: key } });
  if (afterLock) return afterLock;

  const latest = await tx.productionCreditLedgerEntry.findFirst({
    where: { organisationId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, availableAfter: true, reservedAfter: true }
  });
  const movement = nextCreditBalance({
    available: latest?.availableAfter || 0,
    reserved: latest?.reservedAfter || 0,
    entryType,
    quantity
  });

  return tx.productionCreditLedgerEntry.create({
    data: {
      organisationId,
      orderId,
      actorUserId,
      sequence: (latest?.sequence || 0) + 1,
      entryType,
      quantity: Number(quantity),
      availableDelta: movement.availableDelta,
      reservedDelta: movement.reservedDelta,
      availableAfter: movement.availableAfter,
      reservedAfter: movement.reservedAfter,
      idempotencyKey: key,
      externalReference: cleanOptional(externalReference, 240),
      note: cleanOptional(note, 1000),
      expiresAt
    }
  });
}

export async function productionCreditSummary(client, organisationId, take = 30) {
  const [latest, entries] = await Promise.all([
    client.productionCreditLedgerEntry.findFirst({
      where: { organisationId },
      orderBy: { sequence: "desc" },
      select: { availableAfter: true, reservedAfter: true, sequence: true }
    }),
    client.productionCreditLedgerEntry.findMany({
      where: { organisationId },
      orderBy: { sequence: "desc" },
      take,
      include: {
        actor: { select: { id: true, name: true, email: true } },
        order: { select: { id: true, title: true } }
      }
    })
  ]);
  return {
    available: latest?.availableAfter || 0,
    reserved: latest?.reservedAfter || 0,
    sequence: latest?.sequence || 0,
    entries
  };
}


