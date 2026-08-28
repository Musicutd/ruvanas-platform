import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import AIWorkspace from "./AIWorkspace";

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

export default async function AIWorkspacePage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");
  if (adminUser.role !== "SUPER_ADMIN") redirect("/admin");

  const [organisations, jobs] = await Promise.all([
    prisma.organisation.findMany({ select: { id: true, name: true, schoolProfile: { select: { id: true } } }, orderBy: { name: "asc" } }),
    prisma.aIJob.findMany({
      include: {
        organisation: { select: { name: true } },
        requestedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
        metadata: true
      },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Stage 6A · Governed assistance</p>
      <h1 style={styles.title}>AI draft workspace</h1>
      <p style={styles.description}>Create editable retail and school-radio drafts inside a recorded human-review workflow. This first provider-neutral foundation uses Ruvanas local templates and sends no content to a third party.</p>
      <div style={styles.notice}><strong>Human control is mandatory:</strong> assistant output is a draft only. Approval creates an internal artifact; it cannot publish a campaign, change a schedule, or release school content.</div>
      <AIWorkspace organisations={serializable(organisations)} initialJobs={serializable(jobs)} />
    </main>
  );
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 920, margin: "10px 0 16px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", fontSize: 14, lineHeight: 1.5 }
};

