import { prisma } from "@/lib/prisma";
import { createPublicKey } from "node:crypto";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { subscriberProductAccess } from "@/lib/product-access.mjs";
import { createEdgeCredential, edgeCredentialMatches, edgeNodeIsUsable,
  hashEdgeCredential, parseEdgeCredential } from "@/lib/corrections-edge-identity.mjs";

const ENROLMENT_MINUTES = 15;
const MIN_TIER = 4;

function denied(message, status = 403) {
  return Object.assign(new Error(message), { status });
}

function serverSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return secret;
}

const nodeInclude = {
  organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } },
  facility: { include: { correctionsFacility: true } }
};

function edgeEntitled(node) {
  const entitlements = resolveEntitlements(node.organisation?.subscription);
  return entitlements.correctionsRadioEnabled && Number(entitlements.planTierNumber) >= MIN_TIER &&
    subscriberProductAccess(entitlements, "CORRECTIONS").allowed;
}

export async function createCorrectionsEdgeNode({ organisationId, facilityId, name, actorUserId }) {
  const facility = await prisma.location.findFirst({
    where: { id: facilityId, organisationId, status: "ACTIVE", correctionsFacility: { isNot: null } },
    include: { organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } }
  });
  if (!facility) throw denied("Select an active Corrections facility in this organisation.", 400);
  if (!edgeEntitled({ organisation: facility.organisation })) throw denied("Secure Edge requires active Ruvanas Inside Tier 4 or 5 access.");
  if (!name || name.length > 100) throw denied("Enter a node name of up to 100 characters.", 400);
  const expires = new Date(Date.now() + ENROLMENT_MINUTES * 60_000);
  return prisma.$transaction(async (tx) => {
    const node = await tx.correctionsEdgeNode.create({ data: { organisationId, facilityId, name } });
    const enrolmentCredential = createEdgeCredential(node.id, "enrolment");
    await tx.correctionsEdgeNode.update({ where: { id: node.id }, data: {
      enrolmentTokenHash: hashEdgeCredential(enrolmentCredential, serverSecret()), enrolmentExpiresAt: expires
    } });
    await tx.auditLog.create({ data: { organisationId, actorUserId, action: "CORRECTIONS_EDGE_ENROLMENT_CREATED",
      entityType: "CorrectionsEdgeNode", entityId: node.id, details: { facilityId, expiresAt: expires.toISOString() } } });
    return { nodeId: node.id, organisationId, facilityId, enrolmentCredential, expiresAt: expires.toISOString() };
  });
}

export async function enrolCorrectionsEdge(credential, { softwareVersion = null, proofPublicKeyPem } = {}) {
  let proofKey;
  try {
    if (typeof proofPublicKeyPem !== "string" || proofPublicKeyPem.length > 500) throw new Error("Invalid key.");
    proofKey = createPublicKey(proofPublicKeyPem);
    if (proofKey.asymmetricKeyType !== "ed25519" || proofKey.type !== "public") throw new Error("Invalid key.");
  } catch { throw denied("An Ed25519 Edge proof public key is required.", 400); }
  const parsed = parseEdgeCredential(credential, "enrolment");
  if (!parsed) throw denied("Invalid Edge enrolment credential.", 401);
  const node = await prisma.correctionsEdgeNode.findUnique({ where: { id: parsed.nodeId }, include: nodeInclude });
  const now = new Date();
  if (!node || node.status !== "PENDING_ENROLMENT" || !node.enrolmentExpiresAt ||
      node.enrolmentExpiresAt <= now || !edgeCredentialMatches(credential, node.enrolmentTokenHash, serverSecret()) ||
      node.facility.organisationId !== node.organisationId || node.facility.status !== "ACTIVE" ||
      !node.facility.correctionsFacility || !edgeEntitled(node)) throw denied("Edge enrolment is expired or not authorised.", 401);
  const machineCredential = createEdgeCredential(node.id);
  const credentialHash = hashEdgeCredential(machineCredential, serverSecret());
  await prisma.$transaction(async (tx) => {
    const result = await tx.correctionsEdgeNode.updateMany({ where: { id: node.id, status: "PENDING_ENROLMENT",
      enrolmentTokenHash: node.enrolmentTokenHash, enrolmentExpiresAt: { gt: now } }, data: {
      status: "ACTIVE", credentialHash, keyVersion: 1, enrolmentTokenHash: null, enrolmentExpiresAt: null,
      enrolledAt: now, lastSeenAt: now, softwareVersion,
      proofPublicKeyPem: proofKey.export({ type: "spki", format: "pem" })
    } });
    if (result.count !== 1) throw denied("This Edge enrolment credential has already been used.", 409);
    await tx.auditLog.create({ data: { organisationId: node.organisationId, action: "CORRECTIONS_EDGE_ENROLLED",
      entityType: "CorrectionsEdgeNode", entityId: node.id, details: { facilityId: node.facilityId, keyVersion: 1 } } });
  });
  return { nodeId: node.id, organisationId: node.organisationId, facilityId: node.facilityId,
    machineCredential, keyVersion: 1 };
}

export async function authenticateCorrectionsEdge(request) {
  const header = request.headers.get("authorization") || "";
  const credential = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parsed = parseEdgeCredential(credential);
  if (!parsed) throw denied("An Edge machine credential is required.", 401);
  const node = await prisma.correctionsEdgeNode.findUnique({ where: { id: parsed.nodeId }, include: nodeInclude });
  if (!edgeNodeIsUsable(node) || !edgeCredentialMatches(credential, node.credentialHash, serverSecret()) ||
      !edgeEntitled(node)) throw denied("This Edge machine is not authorised.", 401);
  return node;
}

export async function recordCorrectionsEdgeHeartbeat(node, telemetry) {
  const now = new Date();
  const changed = await prisma.correctionsEdgeNode.updateMany({ where: { id: node.id, status: "ACTIVE",
    credentialHash: node.credentialHash }, data: {
    lastSeenAt: now, softwareVersion: telemetry.softwareVersion,
    storageHealth: telemetry.storageHealth, syncStatus: telemetry.syncStatus,
    pendingProofCount: telemetry.pendingProofCount, cachedContentCount: telemetry.cachedContentCount
  } });
  if (changed.count !== 1) throw denied("This Edge machine was revoked or rotated.", 401);
  const latest = await prisma.correctionsEdgeManifest.findFirst({ where: { nodeId: node.id }, orderBy: { sequence: "desc" },
    select: { sequence: true, version: true, validUntil: true } });
  return { nodeId: node.id, serverTime: now.toISOString(), status: "ACTIVE", manifest: latest,
    minimumSoftwareVersion: null };
}

export async function rotateCorrectionsEdgeCredential(nodeId, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const node = await tx.correctionsEdgeNode.findUnique({ where: { id: nodeId } });
    if (!node || node.status !== "ACTIVE") throw denied("Only an active Edge node can rotate its credential.", 409);
    const machineCredential = createEdgeCredential(node.id);
    const keyVersion = node.keyVersion + 1;
    const changed = await tx.correctionsEdgeNode.updateMany({ where: { id: node.id, status: "ACTIVE", keyVersion: node.keyVersion },
      data: { credentialHash: hashEdgeCredential(machineCredential, serverSecret()), keyVersion } });
    if (changed.count !== 1) throw denied("Edge credential changed; retry with current status.", 409);
    await tx.auditLog.create({ data: { organisationId: node.organisationId, actorUserId,
      action: "CORRECTIONS_EDGE_CREDENTIAL_ROTATED", entityType: "CorrectionsEdgeNode", entityId: node.id,
      details: { facilityId: node.facilityId, keyVersion, previousKeyRevokedImmediately: true } } });
    return { nodeId, machineCredential, keyVersion };
  });
}

export async function revokeCorrectionsEdgeNode(nodeId, actorUserId, decommission = false) {
  return prisma.$transaction(async (tx) => {
    const node = await tx.correctionsEdgeNode.findUnique({ where: { id: nodeId } });
    if (!node || ["REVOKED", "DECOMMISSIONED"].includes(node.status)) throw denied("This Edge node is already revoked.", 409);
    const now = new Date();
    const status = decommission ? "DECOMMISSIONED" : "REVOKED";
    await tx.correctionsEdgeNode.update({ where: { id: nodeId }, data: { status, credentialHash: null,
      enrolmentTokenHash: null, enrolmentExpiresAt: null, revokedAt: now } });
    await tx.auditLog.create({ data: { organisationId: node.organisationId, actorUserId,
      action: decommission ? "CORRECTIONS_EDGE_DECOMMISSIONED" : "CORRECTIONS_EDGE_REVOKED",
      entityType: "CorrectionsEdgeNode", entityId: node.id,
      details: { facilityId: node.facilityId, lastSyncAt: node.lastSyncAt, lastSuccessfulSyncAt: node.lastSuccessfulSyncAt,
        cachedMediaRemovalMustBeVerifiedLocally: true } } });
    return { nodeId, status, revokedAt: now.toISOString() };
  });
}
