// Uses the existing session validator against the very same transaction as an
// offer write. Never accept a session/membership/subscription from the browser.
export function createRewardsContextLoader({ db, authenticate, token, env, clock = () => new Date() }) {
  return async function loadContext(transaction = db) {
    const session = await authenticate(token, { db: transaction, env, now: clock(), allowRewardsPilot: true });
    if (!session) return null;
    const user = await transaction.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, privatePreviewAccess: { select: { userId: true } } }
    });
    if (!user) return null;
    const memberships = await transaction.organisationMember.findMany({
      where: { userId: session.userId }, orderBy: { id: "asc" }, take: 1001,
      include: { organisation: { include: { subscription: { include: { plan: true, billingContract: true } } } } }
    });
    // No fallback to a different tenant when a selected membership was removed.
    const membership = memberships.find(row => row.organisationId === session.activeOrganisationId) || null;
    return { session, user, membership, memberships };
  };
}
