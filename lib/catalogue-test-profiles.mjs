// Fixed diagnostic profiles only. These limits never grant ordinary broadcast
// access and must be selected through a server-issued owner authorization.
const shared = { maximumPreparationSeconds: 600, maximumFileBytes: 50 * 1024 * 1024 };
export const CATALOGUE_TEST_PROFILES = Object.freeze({
  FIVE_MINUTES: Object.freeze({ ...shared, id: "FIVE_MINUTES", label: "5 minutes", maximumSeconds: 300,
    maximumAuthorizationSeconds: 600, maximumItems: 8, maximumUniqueFileBytes: 100 * 1024 * 1024,
    maximumAudioBytes: 16 * 1024 * 1024, maximumResources: 16 }),
  ONE_HOUR: Object.freeze({ ...shared, id: "ONE_HOUR", label: "60 minutes", maximumSeconds: 3600,
    maximumAuthorizationSeconds: 4200, maximumItems: 40, maximumUniqueFileBytes: 256 * 1024 * 1024,
    maximumAudioBytes: 64 * 1024 * 1024, maximumResources: 42 }),
});

export function getCatalogueTestProfile(profileId) {
  if (profileId === undefined) return CATALOGUE_TEST_PROFILES.FIVE_MINUTES;
  return typeof profileId === "string" && Object.hasOwn(CATALOGUE_TEST_PROFILES, profileId) ? CATALOGUE_TEST_PROFILES[profileId] : null;
}

export function catalogueTestProfileForAuthorization(authorization) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) return null;
  const profile = getCatalogueTestProfile(authorization.profileId);
  if (!profile || (authorization.maximumSeconds !== profile.maximumSeconds &&
      !(authorization.profileId === undefined && authorization.maximumSeconds === undefined))) return null;
  return profile;
}

export function catalogueTestProfileForSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const profile = session.authorization === undefined ? getCatalogueTestProfile() : catalogueTestProfileForAuthorization(session.authorization);
  if (!profile || (session.profileId !== undefined && session.profileId !== profile.id)) return null;
  // A client-shaped testProfile object never supplies or overrides limits.
  return profile;
}

export function catalogueTestPreparationDeadline(authorization, durationSeconds) {
  const profile = catalogueTestProfileForAuthorization(authorization);
  if (!authorization?.issuedAt || !authorization?.expiresAt) return null;
  const issuedAt = new Date(authorization?.issuedAt).getTime(), expiresAt = new Date(authorization?.expiresAt).getTime();
  if (!profile || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > profile.maximumSeconds) return null;
  return new Date(Math.min(issuedAt + profile.maximumPreparationSeconds * 1000, expiresAt - durationSeconds * 1000));
}
