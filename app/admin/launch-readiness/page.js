import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";
import LaunchReadiness from "./LaunchReadiness";

export const dynamic = "force-dynamic";

export default async function LaunchReadinessPage() {
  const user = await getAdminUser();
  if (user?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  return <div style={styles.page}>
    <header>
      <p style={styles.eyebrow}>Stage 14B · Controlled launch handover</p>
      <h1 style={styles.heading}>Launch readiness</h1>
      <p style={styles.subtitle}>Combine current paid-service health, release consistency, and recovery evidence before completing the human-controlled launch checklist. This view never deploys, publishes, changes customer data, or claims that legal and commercial approval has been granted.</p>
    </header>
    <LaunchReadiness />
  </div>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 940 }
};
