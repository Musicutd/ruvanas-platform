import { cache } from "react";
import { loadPilotAdminPage } from "./pilot-admin-server";

// Cache only within this server render. The page loader checks the feature
// gates, supported Super Admin session and explicit organisation allowlist.
// A navigation link conveys no additional API or merchant authority.
export const canShowRewardPilotNavigation = cache(async () => {
  try { return (await loadPilotAdminPage()).ok === true; }
  catch { return false; }
});
