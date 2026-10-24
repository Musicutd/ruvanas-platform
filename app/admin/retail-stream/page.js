import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { resolveEntitlements } from "@/lib/entitlements.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Retail stream draft | Ruvanas administration" };
const PILOT_EMAIL = "retail@manuelchircop.com";

// This entry point finds an existing pilot only. It does not create an account,
// choose a session organisation, change a plan or prepare any streaming output.
export default async function RetailStreamPilotPage() {
  const actor = await getAdminUser();
  if (!actor) redirect("/login");
  if (actor.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  let organisationId = null;
  try {
    const users = await prisma.user.findMany({
      where: { email: { equals: PILOT_EMAIL, mode: "insensitive" } },
      select: { memberships: { take: 21, select: {
        organisationId: true,
        organisation: { select: { id: true, subscription: { include: { plan: true, billingContract: true } } } }
      } } },
      take: 2
    });
    if (users.length === 1 && users[0].memberships.length <= 20) {
      const eligible = users[0].memberships.filter(membership => {
        if (!membership.organisation || membership.organisation.id !== membership.organisationId) return false;
        const entitlements = resolveEntitlements(membership.organisation.subscription);
        return entitlements.serviceEnabled === true && entitlements.retailRadioEnabled === true;
      });
      if (eligible.length === 1 && /^[A-Za-z0-9_-]{1,191}$/.test(eligible[0].organisationId)) organisationId = eligible[0].organisationId;
    }
  } catch {
    // Never display database diagnostics or silently choose another account.
  }
  if (organisationId) redirect(`/admin/organisations/${encodeURIComponent(organisationId)}/retail-stream`);

  return <section style={{ maxWidth: 760, margin: "36px auto", padding: "0 20px" }}>
    <p>SUPER ADMIN · RETAIL PILOT</p>
    <h1>Choose an existing Retail organisation</h1>
    <p>The pilot account {PILOT_EMAIL} does not currently resolve to exactly one available Retail organisation. Review its existing membership and active Retail permission before continuing.</p>
    <p>No account, plan, channel or streaming connection has been created or changed. Test Radio stays untouched.</p>
    <Link href="/admin/organisations">Review existing organisations →</Link>
  </section>;
}
