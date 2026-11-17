import { getSessionFromToken } from "../session-lookup.js";
import { readPilotAdminPolicy } from "./pilot-admin-contracts.mjs";

const userSelect = {
  id: true, email: true, role: true,
  privatePreviewAccess: { select: {
    userId: true, enabled: true, passwordEnabled: true, organisationId: true, expiresAt: true, pillars: true
  } }
};

// The same loader is used before and within the transaction. Re-read the user
// and full grant from that client instead of trusting a prior session snapshot.
export function createPilotAdminContextLoader({ db, env = {}, token, readSession = getSessionFromToken } = {}) {
  return async function loadContext(client = db) {
    if (!readPilotAdminPolicy(env).enabled) return null;
    const session = await readSession(token, { db: client, env, allowRewardsPilot: true });
    if (!session || !readPilotAdminPolicy(env).enabled) return null;
    const user = await client.user.findUnique({ where: { id: session.userId }, select: userSelect });
    if (!readPilotAdminPolicy(env).enabled) return null;
    return user ? { session, user } : null;
  };
}
