import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { canManageSubscriberPlayers, listSubscriberPlayers, subscriberPlayerAllowance } from "@/lib/subscriber-player-setup.mjs";
import { subscriberPlayerReadiness } from "@/lib/subscriber-player-readiness.mjs";
import PlayerSetupClient from "./PlayerSetupClient";

export const dynamic = "force-dynamic";

export default async function SubscriberPlayersPage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    locations: { orderBy: { name: "asc" }, include: { zones: { orderBy: { name: "asc" } } } }
  });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");

  const now = new Date();
  const organisation = context.membership.organisation;
  const players = await listSubscriberPlayers(prisma, { organisationId: organisation.id, instant: now });
  const allowance = subscriberPlayerAllowance(organisation.subscription, now);
  const configured = players.filter((player) => player.status !== "DISABLED").length;
  const zones = organisation.locations.flatMap((location) => location.zones.map((zone) => ({ id: zone.id, name: zone.name, locationName: location.name })));
  const serviceEnabled = organisation.subscription ? resolveEntitlements(organisation.subscription).serviceEnabled : true;

  return <main style={styles.page}>
    <header style={styles.header}><a href="/dashboard" style={styles.brand}>RUVANAS</a><a href="/dashboard" style={styles.back}>Back to dashboard</a></header>
    <section style={styles.content}>
      <p style={styles.eyebrow}>CLIENT PLAYER SETUP</p>
      <h1 style={styles.heading}>Shop players</h1>
      <p style={styles.subtitle}>Prepare one secure enrolled player for each subscribed shop, and replace a shop device without sharing its player identity.</p>
      {!serviceEnabled ? <p style={styles.warning}>Shop-player setup is currently unavailable for this subscription.</p> : null}
      <PlayerSetupClient
        players={players.map((player) => ({
          id: player.id,
          name: player.name,
          status: player.status,
          zoneName: player.zone.name,
          locationName: player.zone.location.name,
          readiness: subscriberPlayerReadiness(player, now)
        }))}
        zones={zones}
        canManage={serviceEnabled && canManageSubscriberPlayers(context.membership.role)}
        configured={configured}
        limit={allowance.limit}
      />
    </section>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", fontFamily: "Arial, sans-serif" },
  header: { minHeight: 72, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", borderBottom: "1px solid #26344d", background: "#141e2f" },
  brand: { color: "#f4b942", fontWeight: 900, letterSpacing: 2, textDecoration: "none" },
  back: { color: "#f4b942", fontWeight: 800, textDecoration: "none" },
  content: { width: "min(980px, calc(100% - 40px))", margin: "0 auto", padding: "56px 0 72px" },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "0 0 12px" },
  heading: { fontSize: "clamp(34px, 6vw, 54px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, fontSize: 18, maxWidth: 740, margin: "16px 0 28px" },
  warning: { padding: 14, borderRadius: 10, background: "#4a3513", color: "#fde68a", fontWeight: 800 }
};
