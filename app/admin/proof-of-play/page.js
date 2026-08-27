import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

export default async function ProofOfPlayPage() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentWhere = { occurredAt: { gte: since } };
  const [started, completed, failed, activePlayers, events] = await Promise.all([
    prisma.proofOfPlayEvent.count({ where: { ...recentWhere, eventType: "STARTED" } }),
    prisma.proofOfPlayEvent.count({ where: { ...recentWhere, eventType: "COMPLETED" } }),
    prisma.proofOfPlayEvent.count({ where: { ...recentWhere, eventType: "FAILED" } }),
    prisma.proofOfPlayEvent.findMany({
      where: recentWhere,
      distinct: ["playerId"],
      select: { playerId: true }
    }),
    prisma.proofOfPlayEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: { organisation: { select: { name: true } } }
    })
  ]);
  const completionRate = started ? Math.min(1, completed / started) : 0;

  return (
    <div style={styles.page}>
      <header>
        <p style={styles.eyebrow}>PLAYBACK OPERATIONS</p>
        <h1 style={styles.heading}>Proof of play</h1>
        <p style={styles.subtitle}>Confirmed player activity, deduplicated by device event ID and attributed to the signed schedule manifest that authorised playback.</p>
      </header>

      <section style={styles.metrics} aria-label="Last 24 hours">
        <Metric label="Track starts" value={started} />
        <Metric label="Completed" value={completed} />
        <Metric label="Failed" value={failed} tone={failed ? "warning" : "normal"} />
        <Metric label="Completion rate" value={percent(completionRate)} />
        <Metric label="Active players" value={activePlayers.length} />
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Recent confirmations</h2>
        {events.length === 0 ? <p style={styles.subtitle}>No playback confirmations have been received yet.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead><tr><th style={styles.th}>Time</th><th style={styles.th}>Status</th><th style={styles.th}>Track</th><th style={styles.th}>Player</th><th style={styles.th}>Location / zone</th><th style={styles.th}>Organisation</th><th style={styles.th}>Manifest</th></tr></thead>
              <tbody>{events.map((event) => <tr key={event.id}>
                <td style={styles.td}>{event.occurredAt.toLocaleString()}</td>
                <td style={styles.td}><span style={{ ...styles.badge, ...(event.eventType === "FAILED" ? styles.failed : event.eventType === "COMPLETED" ? styles.completed : styles.started) }}>{event.eventType}</span></td>
                <td style={styles.tdStrong}>{event.trackArtist} — {event.trackTitle}</td>
                <td style={styles.td}>{event.playerName}</td>
                <td style={styles.td}>{event.locationName} / {event.zoneName}</td>
                <td style={styles.td}>{event.organisation.name}</td>
                <td style={styles.mono}>{event.manifestVersion}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "normal" }) {
  return <article style={{ ...styles.metric, ...(tone === "warning" ? styles.metricWarning : {}) }}>
    <span style={styles.metricLabel}>{label}</span>
    <strong style={styles.metricValue}>{value}</strong>
    <small style={styles.metricPeriod}>Last 24 hours</small>
  </article>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4 },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 820 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 },
  metric: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 18, background: "#fff", display: "grid", gap: 6 },
  metricWarning: { borderColor: "#fca5a5", background: "#fff7f7" },
  metricLabel: { color: "#475569", fontSize: 13, fontWeight: 800 },
  metricValue: { fontSize: 30, color: "#0f172a" },
  metricPeriod: { color: "#64748b" },
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  sectionTitle: { margin: "0 0 16px", fontSize: 22 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 1080 },
  th: { padding: 10, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 13 },
  td: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#334155", verticalAlign: "top" },
  tdStrong: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#0f172a", fontWeight: 800, verticalAlign: "top" },
  mono: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#475569", fontFamily: "monospace", fontSize: 12, verticalAlign: "top" },
  badge: { display: "inline-block", padding: "5px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  started: { background: "#dbeafe", color: "#1e40af" },
  completed: { background: "#dcfce7", color: "#166534" },
  failed: { background: "#fee2e2", color: "#991b1b" }
};
