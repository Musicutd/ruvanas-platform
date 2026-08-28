import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import ComplianceOperations from "./ComplianceOperations";

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

export default async function CompliancePage() {
  const adminUser = await getAdminUser();
  const canManageCompliance = adminUser?.role === "SUPER_ADMIN";
  const organisations = await prisma.organisation.findMany({
    include: canManageCompliance ? {
      retentionPolicy: true,
      policyAcceptances: { include: { policy: true, acceptedBy: { select: { name: true, email: true } } }, orderBy: { acceptedAt: "desc" }, take: 8 },
      dataRequests: { orderBy: { createdAt: "desc" }, take: 12 },
      retentionJobs: { orderBy: { createdAt: "desc" }, take: 4 },
      auditExportSeals: { include: { exportJob: { select: { id: true, status: true, expiresAt: true } } }, orderBy: { sequence: "desc" }, take: 5 }
    } : undefined,
    orderBy: { name: "asc" }
  });
  const supportTickets = await prisma.supportTicket.findMany({
    include: { organisation: { select: { name: true } }, createdBy: { select: { name: true, email: true } }, assignedTo: { select: { name: true, email: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50
  });
  const administrators = await prisma.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "SUPPORT"] } }, select: { id: true, name: true, email: true, role: true }, orderBy: { email: "asc" } });
  const rightsEvidence = canManageCompliance ? Object.fromEntries(await Promise.all(organisations.map(async (organisation) => {
    const [tracks, confirmed, missing, expiring] = await Promise.all([
      prisma.track.count({ where: { mediaAsset: { organisationId: organisation.id } } }),
      prisma.track.count({ where: { mediaAsset: { organisationId: organisation.id }, rightsConfirmedAt: { not: null }, rightsReference: { not: null } } }),
      prisma.track.count({ where: { mediaAsset: { organisationId: organisation.id }, OR: [{ rightsConfirmedAt: null }, { rightsReference: null }] } }),
      prisma.track.count({ where: { mediaAsset: { organisationId: organisation.id }, licenceExpiresAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) } } })
    ]);
    return [organisation.id, { tracks, confirmed, missing, expiring }];
  }))) : {};

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Stage 5F · Controlled operations</p>
      <h1 style={styles.title}>Compliance & support</h1>
      <p style={styles.description}>Maintain evidence, respond to privacy requests, preview retention impact, export a tamper-evident audit chain, and link support incidents to operational records.</p>
      <div style={styles.notice}><strong>Safety boundary:</strong> retention runs are previews only and never delete records. These tools support accountable operations but do not, by themselves, constitute legal or regulatory certification.</div>
      <ComplianceOperations
        role={adminUser.role}
        organisations={serializable(organisations)}
        supportTickets={serializable(supportTickets)}
        administrators={serializable(administrators)}
        rightsEvidence={rightsEvidence}
      />
    </main>
  );
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 900, margin: "10px 0 16px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", fontSize: 14, lineHeight: 1.5 }
};


