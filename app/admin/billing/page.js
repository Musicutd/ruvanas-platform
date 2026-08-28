import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import BillingControls from "./BillingControls";

export default async function AdminBillingPage() {
  const adminUser = await getAdminUser();
  if (adminUser?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const organisations = await prisma.organisation.findMany({
    include: {
      subscription: { include: { plan: true, billingContract: true } },
      billingAccount: {
        include: {
          invoices: { orderBy: { createdAt: "desc" }, take: 1 },
          reconciliations: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      },
      billingReconciliations: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { name: "asc" }
  });

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Stage 5D · Commercial operations</p>
      <h1 style={styles.title}>Billing & usage</h1>
      <p style={styles.description}>
        Connect subscriptions to a billing provider, control payment grace periods,
        and compare billed usage with Ruvanas platform records. No organisation data
        or stream is deleted when access is suspended.
      </p>

      <section style={styles.card}>
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {[
                  "Organisation",
                  "Plan",
                  "Access",
                  "Provider",
                  "Grace ends",
                  "Latest invoice",
                  "Usage check",
                  "Controls"
                ].map((label) => <th key={label} style={styles.th}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {organisations.map((organisation) => {
                const account = organisation.billingAccount;
                const contract = organisation.subscription?.billingContract;
                const invoice = account?.invoices?.[0];
                const reconciliation = organisation.billingReconciliations[0];
                return (
                  <tr key={organisation.id} style={styles.tr}>
                    <td style={styles.strongCell}>{organisation.name}</td>
                    <td style={styles.td}>{organisation.subscription?.plan?.name || "No plan"}</td>
                    <td style={styles.td}>{organisation.subscription?.status || "Not subscribed"}</td>
                    <td style={styles.td}>{account?.provider || "Not connected"}</td>
                    <td style={styles.td}>
                      {contract?.graceEndsAt
                        ? new Date(contract.graceEndsAt).toLocaleString()
                        : "Not set"}
                    </td>
                    <td style={styles.td}>{invoice?.status || "No invoice"}</td>
                    <td style={styles.td}>{reconciliation?.status || "Not checked"}</td>
                    <td style={styles.td}>
                      {organisation.subscription
                        ? <BillingControls organisation={{
                            id: organisation.id,
                            subscription: {
                              status: organisation.subscription.status,
                              billingContract: contract ? {
                                externalSubscriptionId: contract.externalSubscriptionId,
                                providerStatus: contract.providerStatus,
                                graceEndsAt: contract.graceEndsAt?.toISOString() || null
                              } : null
                            },
                            billingAccount: account ? {
                              provider: account.provider,
                              externalCustomerId: account.externalCustomerId
                            } : null
                          }} />
                        : <span style={styles.muted}>Subscription required</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: 0, color: "#111827", fontSize: 32, fontWeight: 900 },
  description: { maxWidth: 820, margin: "10px 0 28px", color: "#475569", fontSize: 15, lineHeight: 1.55 },
  card: { padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" },
  tableWrapper: { overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  table: { width: "100%", minWidth: 1180, borderCollapse: "collapse" },
  th: { padding: "13px 12px", borderBottom: "2px solid #94a3b8", background: "#e2e8f0", color: "#172033", fontSize: 13, fontWeight: 900, textAlign: "left", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #cbd5e1" },
  td: { padding: "14px 12px", color: "#334155", fontSize: 13, fontWeight: 650, verticalAlign: "top", whiteSpace: "nowrap" },
  strongCell: { padding: "14px 12px", color: "#111827", fontSize: 14, fontWeight: 900, verticalAlign: "top" },
  muted: { color: "#64748b", fontSize: 12, fontWeight: 700 }
};

