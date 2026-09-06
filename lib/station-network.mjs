export const STATION_NETWORK_TERMS_VERSION = "station-network-membership-v1";
export const STATION_NETWORK_STATUSES = Object.freeze(["ACTIVE", "PAUSED", "ARCHIVED"]);
export const STATION_NETWORK_MANAGER_ROLES = Object.freeze(["OWNER", "MANAGER"]);

function boundedText(value, label, maximum, { required = false } = {}) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return normalized || null;
}

export function normalizeStationNetworkInput(input = {}) {
  return {
    name: boundedText(input.name, "Network name", 100, { required: true }),
    description: boundedText(input.description, "Description", 500)
  };
}

export function normalizeStationNetworkStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!STATION_NETWORK_STATUSES.includes(normalized)) throw new Error("Choose an active, paused or archived network status.");
  return normalized;
}

export function canManageStationNetwork(role) {
  return STATION_NETWORK_MANAGER_ROLES.includes(role);
}

export function canApproveStationNetworkAgreement(role) {
  return role === "OWNER";
}

export function stationNetworkAgreementTransition({ currentStatus, action, actorSide }) {
  const status = String(currentStatus || "").toUpperCase();
  const normalizedAction = String(action || "").toUpperCase();
  if (actorSide === "STATION" && status === "INVITED" && normalizedAction === "ACCEPT") return "ACTIVE";
  if (actorSide === "STATION" && status === "INVITED" && normalizedAction === "DECLINE") return "DECLINED";
  if (actorSide === "STATION" && status === "ACTIVE" && normalizedAction === "LEAVE") return "REVOKED";
  if (actorSide === "NETWORK" && ["INVITED", "ACTIVE"].includes(status) && normalizedAction === "REVOKE") return "REVOKED";
  throw new Error("That network membership action is not available in its current state.");
}

export function stationNetworkAgreementSummary(agreement) {
  return {
    id: agreement.id,
    status: agreement.status,
    termsVersion: agreement.termsVersion,
    invitedAt: agreement.invitedAt,
    decidedAt: agreement.decidedAt,
    revokedAt: agreement.revokedAt,
    station: {
      id: agreement.station.id,
      name: agreement.station.name,
      slug: agreement.station.slug,
      status: agreement.station.status
    },
    organisation: {
      id: agreement.stationOrganisation.id,
      name: agreement.stationOrganisation.name,
      slug: agreement.stationOrganisation.slug
    }
  };
}

export function stationNetworkSummary(network, { activeOrganisationId, activeRole } = {}) {
  const agreements = (network.agreements || []).map(stationNetworkAgreementSummary);
  const isOperator = network.ownerOrganisationId === activeOrganisationId;
  return {
    id: network.id,
    name: network.name,
    slug: network.slug,
    description: network.description,
    status: network.status,
    ownerOrganisation: {
      id: network.ownerOrganisation.id,
      name: network.ownerOrganisation.name,
      slug: network.ownerOrganisation.slug
    },
    role: isOperator ? "NETWORK_OPERATOR" : "PARTICIPATING_STATION",
    permissions: {
      canManage: isOperator && canManageStationNetwork(activeRole),
      canApproveForStation: !isOperator && canApproveStationNetworkAgreement(activeRole)
    },
    counts: {
      active: agreements.filter((agreement) => agreement.status === "ACTIVE").length,
      invited: agreements.filter((agreement) => agreement.status === "INVITED").length,
      total: agreements.length
    },
    agreements
  };
}

export function stationNetworkFleetSummary(agreements = []) {
  return agreements.reduce((summary, agreement) => {
    summary.total += 1;
    const key = String(agreement.status || "").toLowerCase();
    if (Object.hasOwn(summary, key)) summary[key] += 1;
    return summary;
  }, { total: 0, invited: 0, active: 0, declined: 0, revoked: 0 });
}
