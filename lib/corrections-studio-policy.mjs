import { createHash, randomBytes } from "node:crypto";

export const CORRECTIONS_STUDIO_CAPABILITIES = Object.freeze(["RECORD", "EDIT", "RENDER", "SUBMIT"]);
export const CORRECTIONS_STUDIO_MAX_MINUTES = 240;

export function createCorrectionsStudioToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCorrectionsStudioToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return createHash("sha256").update(value).digest("hex");
}

export function correctionsStudioSessionAvailable(session, now = new Date()) {
  return Boolean(session?.status === "ACTIVE" && session.accessTokenHash && session.activatedAt &&
    session.expiresAt && new Date(session.activatedAt) <= now && new Date(session.expiresAt) > now &&
    !session.revokedAt && session.contributor?.status === "ACTIVE" &&
    session.programme?.organisationId === session.organisationId &&
    session.programme?.facilityId === session.facilityId &&
    session.facility?.organisationId === session.organisationId &&
    session.facility?.status !== "CLOSED" &&
    ["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(session.programme?.status) &&
    session.project?.organisationId === session.organisationId &&
    session.contributor?.organisationId === session.organisationId &&
    session.contributor?.facilityId === session.facilityId);
}

export function correctionsStudioCan(session, capability) {
  return CORRECTIONS_STUDIO_CAPABILITIES.includes(capability) &&
    Array.isArray(session?.capabilityScope) && session.capabilityScope.includes(capability);
}

export function correctionsStudioSupervisorAllowed({ role, grant, organisationId, memberId, facilityId } = {}) {
  if (role === "OWNER") return true;
  return role === "MANAGER" && grant?.permission === "MANAGER" && grant.organisationId === organisationId &&
    grant.organisationMemberId === memberId && grant.facilityId === facilityId;
}
