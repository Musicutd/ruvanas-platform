import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRetailRewardsAccess } from "./access.mjs";
import { createRewardsDatabaseAdapter } from "./database-adapter.mjs";

// Server entry point only. No route consumes this foundation yet. Reuse the
// authenticated subscription object so the core resolver's binding is retained.
// The policy gate executes before loadContext or any database loader is called.
export function requireRetailRewardsServerAccess(input) {
  return requireRetailRewardsAccess(input, {
    env: process.env,
    loadContext: () => getActiveOrganisationContext({
      subscription: { include: { plan: true, billingContract: true } }
    }),
    ...createRewardsDatabaseAdapter(prisma)
  });
}
