import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import EnterpriseSecurityControls from "./EnterpriseSecurityControls";

export default async function AdminSecurityPage() {
  const adminUser = await getAdminUser();
  if (adminUser?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const organisations = await prisma.organisation.findMany({
    include: {
      enterpriseSecurityPolicy: true,
      enterpriseIdentityProviders: { orderBy: { createdAt: "desc" } },
      serviceAccounts: {
        include: {
          apiKeys: {
            select: { id: true, name: true, prefix: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true },
            orderBy: { createdAt: "desc" }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: { name: "asc" }
  });

  const payload = organisations.map((organisation) => ({
    id: organisation.id,
    name: organisation.name,
    policy: organisation.enterpriseSecurityPolicy || {
      ssoRequired: false,
      passwordFallback: true,
      sessionMaxAgeMinutes: 43200,
      idleTimeoutMinutes: 1440,
      allowedEmailDomains: []
    },
    identityProviders: organisation.enterpriseIdentityProviders,
    serviceAccounts: organisation.serviceAccounts
  }));

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Stage 5E · Enterprise controls</p>
      <h1 style={styles.title}>Identity & security</h1>
      <p style={styles.description}>
        Apply organisation session controls, prepare an OIDC or SAML connection,
        and issue scoped API keys to non-human service accounts. Keys are shown once
        and only cryptographic hashes are retained.
      </p>
      <div style={styles.notice}>
        Existing password login remains available. SSO enforcement cannot be enabled
        until a verified identity-provider handshake is connected, protecting every
        organisation from accidental lockout.
      </div>
      <EnterpriseSecurityControls organisations={payload} />
    </main>
  );
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 850, margin: "10px 0 16px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  notice: { marginBottom: 24, padding: 14, border: "1px solid #f0b429", borderRadius: 9, background: "#fff8e6", color: "#6b4700", fontSize: 14, fontWeight: 700, lineHeight: 1.5 }
};

