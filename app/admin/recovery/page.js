import RecoveryReadiness from "./RecoveryReadiness";

export const dynamic = "force-dynamic";

export default function RecoveryPage() {
  return <div style={styles.page}>
    <header>
      <p style={styles.eyebrow}>Stage 12D · Backup and recovery</p>
      <h1 style={styles.heading}>Recovery readiness</h1>
      <p style={styles.subtitle}>Record provider-neutral confirmation of database backups, protected-storage recovery, recovery targets, and restore drills. Ruvanas stores safe references and audit evidence only—never credentials, private provider links, database copies, or customer content.</p>
    </header>
    <RecoveryReadiness />
  </div>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 920 }
};
