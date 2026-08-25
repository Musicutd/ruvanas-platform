export function selectActiveMembership(memberships, activeOrganisationId) {
  if (!Array.isArray(memberships) || memberships.length === 0) {
    return null;
  }

  return (
    memberships.find(
      (membership) => membership.organisationId === activeOrganisationId
    ) || memberships[0]
  );
}

