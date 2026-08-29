import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import SchoolSafeguardingReviewConsole from "./SchoolSafeguardingReviewConsole";

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

export default async function SchoolSafeguardingReviewPage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const readinessPacks = await prisma.schoolSafeguardingReadiness.findMany({
    include: {
      organisation: { select: { id: true, name: true, slug: true } },
      reviews: {
        include: { reviewer: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 8
      }
    },
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }, { updatedAt: "desc" }]
  });

  return <main style={styles.page}>
    <p style={styles.eyebrow}>Stage 9B1 · Controlled safeguarding decisions</p>
    <h1 style={styles.title}>School safeguarding review</h1>
    <p style={styles.description}>Review submitted school policy packs, request precise changes, and preserve an auditable snapshot of each decision.</p>
    <div style={styles.notice}><strong>Safety boundary:</strong> approval confirms the readiness pack only. It does not enable student accounts, direct messaging, or public publishing.</div>
    <SchoolSafeguardingReviewConsole readinessPacks={serializable(readinessPacks)} />
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 900, margin: "10px 0 16px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", fontSize: 14, lineHeight: 1.5 }
};
