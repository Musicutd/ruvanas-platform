import JobOperations from "./JobOperations";

export const dynamic = "force-dynamic";

export default function JobOperationsPage() {
  return <div style={styles.page}>
    <header>
      <p style={styles.eyebrow}>STAGE 11D · RELIABLE OPERATIONS</p>
      <h1 style={styles.heading}>Jobs and notification delivery</h1>
      <p style={styles.subtitle}>Monitor leased work, retries, completed notification delivery, and dead-letter recovery without exposing job payloads or secrets.</p>
    </header>
    <JobOperations />
  </div>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4 },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 820 }
};
