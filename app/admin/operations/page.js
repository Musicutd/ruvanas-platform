import OperationalHealth from "./OperationalHealth";

export const dynamic = "force-dynamic";

export default function OperationsPage() {
  return <div style={styles.page}>
    <header>
      <p style={styles.eyebrow}>Stage 12C · Operational observability</p>
      <h1 style={styles.heading}>Platform health and release status</h1>
      <p style={styles.subtitle}>Review safe aggregate service heartbeats, release consistency, queue pressure, player and stream incidents, protected-media failures, and proof-ingest freshness. No customer content, credentials, raw errors, or student data is shown here.</p>
    </header>
    <OperationalHealth />
  </div>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 900 }
};
