export const CORRECTIONS_NETWORK_CAPABILITIES = Object.freeze([
  "view", "manage", "policy", "programme", "distribute", "report", "audit"
]);

// Facility grants confer no network rights, and C6 override grants are not
// represented here. An OWNER is the explicit organisation-level authority;
// every other member needs a separate network grant and a compatible role.
export function correctionsNetworkPermission({ tier, correctionsEnabled, role, grant, organisationId, memberId, capability = "view" } = {}) {
  if (!correctionsEnabled || Number(tier) < 4 || !CORRECTIONS_NETWORK_CAPABILITIES.includes(capability) || !organisationId || !memberId) return false;
  if (role === "OWNER") return true;
  if (!grant || grant.organisationId !== organisationId || grant.organisationMemberId !== memberId || !grant[`can${capability[0].toUpperCase()}${capability.slice(1)}`]) return false;
  if (["view", "report", "audit"].includes(capability)) return ["MANAGER", "CONTENT_EDITOR", "VIEWER"].includes(role);
  if (capability === "programme") return ["MANAGER", "CONTENT_EDITOR"].includes(role);
  return role === "MANAGER";
}

export const NETWORK_CONTENT_TYPES = Object.freeze(["PROGRAMME", "REHABILITATION", "REQUEST", "ANNOUNCEMENT"]);

export function normalizeCorrectionsNetworkWindow(input = {}) {
  const kind = String(input.kind || "").toUpperCase();
  const weekday = Number(input.weekday);
  const startMinute = Number(input.startMinute);
  const endMinute = Number(input.endMinute);
  if (!["CENTRAL", "LOCAL"].includes(kind) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      !Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1439 ||
      !Number.isInteger(endMinute) || endMinute <= startMinute || endMinute > 1440) {
    throw new Error("Choose a valid weekly central or local time window.");
  }
  const types = Array.isArray(input.allowedContentTypes) ? [...new Set(input.allowedContentTypes.map((value) => String(value).toUpperCase()))] : [];
  if (!types.length || types.some((value) => !NETWORK_CONTENT_TYPES.includes(value))) throw new Error("Choose one or more permitted content types.");
  if (kind === "CENTRAL" && (typeof input.distributionId !== "string" || !input.distributionId.trim())) throw new Error("A central window needs a pinned distribution.");
  if (kind === "LOCAL" && (input.distributionId || input.mandatory)) throw new Error("A local window cannot claim mandatory central authority.");
  return { kind, weekday, startMinute, endMinute, mandatory: kind === "CENTRAL" && input.mandatory === true,
    distributionId: kind === "CENTRAL" ? input.distributionId.trim() : null, allowedContentTypes: types };
}

export function correctionsWindowConflict(existing, candidate) {
  if (existing.facilityId !== candidate.facilityId || existing.weekday !== candidate.weekday || existing.active === false ||
      existing.startMinute >= candidate.endMinute || candidate.startMinute >= existing.endMinute) return null;
  if (existing.kind === candidate.kind) return "OVERLAPPING_SAME_KIND";
  if ((existing.kind === "CENTRAL" && existing.mandatory) || (candidate.kind === "CENTRAL" && candidate.mandatory)) return "MANDATORY_CENTRAL_CONFLICT";
  // A local window may deliberately sit over a non-mandatory central default.
  return null;
}

export function resolveCorrectionsNetworkWindow(windows, { facilityId, weekday, minute } = {}) {
  const active = windows.filter((item) => item.active !== false && item.facilityId === facilityId && item.weekday === weekday && item.startMinute <= minute && minute < item.endMinute);
  return active.find((item) => item.kind === "CENTRAL" && item.mandatory) ||
    active.find((item) => item.kind === "LOCAL") ||
    active.find((item) => item.kind === "CENTRAL") || null;
}

export function resolveCorrectionsDistributionTargets({ allFacilities = [], selectedIds = [], groupMembers = [] } = {}) {
  if (!Array.isArray(selectedIds) || !Array.isArray(groupMembers) || selectedIds.length + groupMembers.length > 100) throw new Error("Choose up to 100 facility targets.");
  const requested = [...new Set([...selectedIds, ...groupMembers])];
  if (!requested.length || requested.some((id) => typeof id !== "string" || !id)) throw new Error("Choose at least one facility.");
  const available = new Set(allFacilities.filter((item) => item.active).map((item) => item.id));
  if (requested.some((id) => !available.has(id))) throw new Error("A target facility is unavailable or outside this authority.");
  return requested.sort();
}
