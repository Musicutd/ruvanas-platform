import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { canManagePlayerSessions, listActivePlayerSessions } from "@/lib/player-session-management.mjs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function timeLabel(value) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default async function PlayerSessionsPage({ searchParams }) {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
  if (!context) redirect("/login");
  if (!context.membership) redirect("/dashboard");

  const query = await searchParams;
  const organisation = context.membership.organisation;
  const entitlements = resolveEntitlements(organisation.subscription);
  const sessions = await listActivePlayerSessions(prisma, { organisationId: organisation.id });
  const canManage = canManagePlayerSessions(context.membership.role);

  return <main style={styles.page}>
    <header style={styles.header}>
      <a href="/dashboard" style={styles.brand}>RUVANAS</a>
      <a href="/dashboard" style={styles.backLink}>Back to dashboard</a>
    </header>
    <section style={styles.content}>
      <p style={styles.eyebrow}>CLIENT STREAM CONTROL</p>
      <h1 style={styles.title}>Active shop streams</h1>
      <p style={styles.subtitle}>See which enrolled shop players are using your plan and release a session that should no longer be active.</p>

      {query?.released === "1" ? <p style={styles.success}>The player session was stopped and its stream slot is now available.</p> : null}

      <section style={styles.summary}>
        <div><span style={styles.summaryLabel}>Organisation</span><strong>{organisation.name}</strong></div>
        <div><span style={styles.summaryLabel}>Active now</span><strong>{sessions.length} / {entitlements.streamLimit}</strong></div>
        <div><span style={styles.summaryLabel}>Your access</span><strong>{canManage ? "Can stop sessions" : "View only"}</strong></div>
      </section>

      {!sessions.length ? <section style={styles.empty}>
        <h2 style={styles.sessionTitle}>No active shop streams</h2>
        <p style={styles.copy}>A player appears here as soon as it starts using a stream slot.</p>
      </section> : <section style={styles.list}>
        {sessions.map((session) => <article key={session.id} style={styles.sessionCard}>
          <div>
            <p style={styles.status}>LIVE SESSION</p>
            <h2 style={styles.sessionTitle}>{session.player.name}</h2>
            <p style={styles.copy}>{session.player.zone.location.name} / {session.player.zone.name}</p>
            <p style={styles.meta}>Last confirmed {timeLabel(session.lastSeenAt)} · lease renews automatically</p>
          </div>
          {canManage ? <form action={`/api/player-sessions/${session.id}/revoke`} method="post">
            <button type="submit" style={styles.stopButton}>Stop this session</button>
          </form> : null}
        </article>)}
      </section>}

      <p style={styles.note}>Stopping a session is recorded in the organisation audit trail. The stopped browser is refused during the safety window; disabling an enrolled player remains available to Ruvanas operations for permanent device retirement.</p>
    </section>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#ffffff", fontFamily: "Arial, sans-serif" },
  header: { minHeight: 72, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", borderBottom: "1px solid #26344d", background: "#141e2f" },
  brand: { color: "#f4b942", fontWeight: 900, letterSpacing: 2, textDecoration: "none" },
  backLink: { color: "#f4b942", fontWeight: 800, textDecoration: "none" },
  content: { width: "min(980px, calc(100% - 40px))", margin: "0 auto", padding: "56px 0 72px" },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "0 0 12px" },
  title: { fontSize: "clamp(34px, 6vw, 54px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, fontSize: 18, maxWidth: 720, margin: "16px 0 30px" },
  success: { border: "1px solid #2f855a", borderRadius: 10, background: "#153c2d", color: "#9ae6b4", padding: 16, fontWeight: 800 },
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, padding: 20, borderRadius: 14, background: "#182235", border: "1px solid #2b3a54", marginBottom: 24 },
  summaryLabel: { color: "#9cacbf", display: "block", fontSize: 12, fontWeight: 800, letterSpacing: 0.8, marginBottom: 7, textTransform: "uppercase" },
  list: { display: "grid", gap: 14 },
  sessionCard: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap", padding: 22, borderRadius: 14, background: "#182235", border: "1px solid #2b3a54" },
  empty: { padding: 28, borderRadius: 14, background: "#182235", border: "1px solid #2b3a54" },
  status: { color: "#86efac", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  sessionTitle: { fontSize: 24, margin: "0 0 8px" },
  copy: { color: "#d6deeb", lineHeight: 1.5, margin: 0 },
  meta: { color: "#9cacbf", fontSize: 13, margin: "8px 0 0" },
  stopButton: { minHeight: 44, border: "1px solid #ef4444", borderRadius: 8, background: "#3d1820", color: "#fecaca", cursor: "pointer", fontWeight: 900, padding: "10px 16px" },
  note: { color: "#9cacbf", fontSize: 13, lineHeight: 1.6, marginTop: 24 }
};
