import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import EnterpriseScaleWorkspace from "./EnterpriseScaleWorkspace";

export const dynamic = "force-dynamic";

export default async function EnterpriseScalePage() {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") redirect("/admin/organisations");
  return <main style={styles.page}>
    <header>
      <p style={styles.eyebrow}>Stage 19.26 · Enterprise and scale</p>
      <h1 style={styles.heading}>Enterprise scale readiness</h1>
      <p style={styles.subtitle}>Review privacy-safe fleet totals, internal capacity guardrails, continuity objectives and accountable test evidence before expanding the paid Ruvanas service. This workspace never changes live playout, provider routing or customer data.</p>
    </header>
    <EnterpriseScaleWorkspace />
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 940 }
};
