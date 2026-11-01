import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { canManageSubscriberPlayers, listSubscriberPlayers, subscriberPlayerAllowance } from "@/lib/subscriber-player-setup.mjs";
import { subscriberPlayerReadiness } from "@/lib/subscriber-player-readiness.mjs";
import ContextHelp from "@/app/components/ContextHelp";
import SkipLink from "@/app/components/SkipLink";
import PlayerSetupClient from "./PlayerSetupClient";
import { resolveRetailSubscriberWorkspace } from "@/lib/retail-subscriber-access.mjs";
import { subscriberWorkflowRequestAllowed } from "@/lib/private-preview-subscriber-testing.mjs";
import { annotateRetailTestPlayerReadiness } from "@/lib/retail-test-stream-evidence.mjs";

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
  const players = await annotateRetailTestPlayerReadiness(prisma,
    await listSubscriberPlayers(prisma, { organisationId: organisation.id, instant: now }), { now });
  const allowance = subscriberPlayerAllowance(organisation.subscription, now);
  if (allowance.physicalProduct === false) redirect("/dashboard/account?reason=not-included");
  const configured = players.filter((player) => player.status !== "DISABLED").length;
  const zones = organisation.locations.flatMap((location) => location.zones.map((zone) => ({ id: zone.id, name: zone.name, locationName: location.name })));
  const serviceEnabled = organisation.subscription ? resolveEntitlements(organisation.subscription).serviceEnabled : true;
  const retailWorkspace = await resolveRetailSubscriberWorkspace(prisma, context, { now });
  const setupAccessEnabled = subscriberWorkflowRequestAllowed(context, { pathname: "/api/player-setup", method: "POST", now });

  return <main style={styles.page}>
    <SkipLink />
    <header style={styles.header}><a href={retailWorkspace ? "/dashboard/retail" : "/dashboard"} style={styles.brand}>RUVANAS</a><a href={retailWorkspace ? "/dashboard/retail" : "/dashboard"} style={styles.back}>{retailWorkspace ? "Back to Retail" : "Back to dashboard"}</a></header>
    <section style={styles.content} id="main-content">
      <p style={styles.eyebrow}>{retailWorkspace ? "RETAIL · SHOP SETUP" : "CLIENT PLAYER SETUP"}</p>
      <h1 style={styles.heading}>{retailWorkspace ? "Shop devices" : "Players & devices"}</h1>
      <p style={styles.subtitle}>{retailWorkspace ? "Connect a dedicated player when you are ready to set up a shop. Listening and planning are available separately." : "Prepare one secure enrolled player for each subscribed location or listening area, and replace a device without sharing its player identity."}</p>
      {!retailWorkspace && <ContextHelp
        title="Help with your first player"
        introduction="Use one enrolled player for each subscribed location or listening area. The setup page checks the real device connection and playback evidence for you."
        items={[
          { title: "Before enrolment", description: "The location and listening area must already be available. Ruvanas operations can prepare them when required." },
          { title: "One-time code", description: "Enter the code only on the device that will remain in that listening area. Do not reuse or share it." },
          { title: "Ready means verified", description: "The player is ready only after enrolment, channel assignment, recent contact and playback evidence." }
        ]}
        articleHref="/dashboard/help#shop-players"
        articleLabel="Open the player guide"
      />}
      {!serviceEnabled ? <p style={styles.warning}>Player setup is currently unavailable for this subscription.</p> : null}
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
        canManage={setupAccessEnabled && serviceEnabled && canManageSubscriberPlayers(context.membership.role)}
        setupAccessEnabled={setupAccessEnabled}
        configured={configured}
        limit={allowance.limit}
        retail={Boolean(retailWorkspace)}
      />
    </section>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "var(--rv-page-bg)", color: "var(--rv-text)", fontFamily: "Arial, sans-serif" },
  header: { minHeight: 72, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", borderBottom: "1px solid #26344d", background: "var(--rv-surface)" },
  brand: { color: "#f4b942", fontWeight: 900, letterSpacing: 2, textDecoration: "none" },
  back: { color: "#f4b942", fontWeight: 800, textDecoration: "none" },
  content: { width: "min(980px, calc(100% - 40px))", margin: "0 auto", padding: "56px 0 72px" },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "0 0 12px" },
  heading: { fontSize: "clamp(34px, 6vw, 54px)", margin: 0 },
  subtitle: { color: "var(--rv-text-muted)", lineHeight: 1.6, fontSize: 18, maxWidth: 740, margin: "16px 0 28px" },
  warning: { padding: 14, borderRadius: 10, background: "var(--rv-warning-bg)", color: "var(--rv-warning-text)", fontWeight: 800 }
};
