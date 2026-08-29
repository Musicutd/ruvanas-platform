import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import IntegrationConsole from "./IntegrationConsole";

function serializable(value) { return JSON.parse(JSON.stringify(value)); }

export default async function IntegrationsPage() {
  const user = await getAdminUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");
  const [organisations, connections] = await Promise.all([
    prisma.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.integrationConnection.findMany({
      include: {
        organisation: { select: { name: true } },
        _count: { select: { events: true, syncRuns: true, metricSummaries: true } },
        events: { select: { id: true, eventType: true, status: true, attemptCount: true, lastError: true, createdAt: true, deliveredAt: true }, orderBy: { createdAt: "desc" }, take: 8 },
        syncRuns: { select: { id: true, status: true, sourceTimestamp: true, summary: true, errorMessage: true, createdAt: true, completedAt: true }, orderBy: { createdAt: "desc" }, take: 8 }
      },
      orderBy: { createdAt: "desc" }
    })
  ]);
  return <main style={styles.page}>
    <p style={styles.eyebrow}>Stage 6C · Controlled connectivity</p>
    <h1 style={styles.title}>API & integrations</h1>
    <p style={styles.description}>Connect approved systems through versioned APIs, signed webhooks and privacy-safe sales, inventory or footfall summaries. Every transfer is tenant-scoped, idempotent and auditable, and no integration receives direct database access.</p>
    <div style={styles.notice}><strong>Safe by default:</strong> metric connections accept location-level summaries only - never customer identities or order-level records. Correlation data is not presented as proof that audio caused a commercial outcome.</div>
    <IntegrationConsole organisations={serializable(organisations)} initialConnections={serializable(connections)} />
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 920, margin: "10px 0 16px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", fontSize: 14, lineHeight: 1.5 }
};

