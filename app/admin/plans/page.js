import { redirect } from "next/navigation";
import PageHeader from "@/app/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { findPublicPlan, RUVANAS_PRODUCTS } from "@/lib/product-plan-catalogue.mjs";
import { getAdminUser } from "@/lib/requireAdmin";

const PRODUCT_LABELS = Object.freeze({
  RETAIL: "Retail Radio",
  SCHOOL: "School Radio",
  ONLINE: "Online Radio",
  MULTI: "Custom multi-product"
});

const PRODUCT_FIELDS = Object.freeze([
  ["Retail", "retailRadioEnabled"],
  ["School", "schoolRadioEnabled"],
  ["Online", "onlineRadioEnabled"]
]);

function planOrder(plan) {
  const productIndex = RUVANAS_PRODUCTS.indexOf(plan.productFamily);
  return [productIndex < 0 ? 99 : productIndex, plan.tierNumber || 99, plan.name];
}

function comparePlans(left, right) {
  const a = planOrder(left);
  const b = planOrder(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function formatPrice(plan) {
  const amount = new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(plan.monthlyPriceCents / 100);
  return plan.tierNumber === 5 && plan.publiclyAvailable ? `From ${amount}` : amount;
}

function ProductBadges({ plan }) {
  return (
    <div style={styles.badges}>
      {PRODUCT_FIELDS.map(([label, field]) => (
        <span key={field} style={plan[field] ? styles.includedBadge : styles.excludedBadge}>
          {label}: {plan[field] ? "On" : "Off"}
        </span>
      ))}
    </div>
  );
}

export default async function AdminPlanCataloguePage() {
  const adminUser = await getAdminUser();
  if (adminUser?.role !== "SUPER_ADMIN") redirect("/admin/organisations");

  const plans = (await prisma.plan.findMany()).sort(comparePlans);
  const publicPlans = plans.filter((plan) => plan.publiclyAvailable);
  const legacyPlans = plans.filter((plan) => !plan.publiclyAvailable);

  return (
    <main style={styles.page}>
      <PageHeader
        eyebrow="Commercial control"
        title="Plan catalogue"
        description="Review the server-owned Retail, School and Online Radio tiers, their product authority and Licensed Music Catalogue level. Changes remain code-controlled and auditable."
      />

      <section style={styles.summaryGrid} aria-label="Plan catalogue summary">
        <article style={styles.summaryCard}>
          <strong style={styles.summaryValue}>{publicPlans.length}</strong>
          <span style={styles.summaryLabel}>public tiers</span>
        </article>
        {RUVANAS_PRODUCTS.map((product) => (
          <article key={product} style={styles.summaryCard}>
            <strong style={styles.summaryValue}>{publicPlans.filter((plan) => plan.productFamily === product).length}</strong>
            <span style={styles.summaryLabel}>{PRODUCT_LABELS[product]} tiers</span>
          </article>
        ))}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeading}>
          <div>
            <p style={styles.kicker}>Authoritative commercial offer</p>
            <h2 style={styles.sectionTitle}>Public plans</h2>
          </div>
          <span style={styles.readOnly}>Read-only</span>
        </div>
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Plan", "Product", "Tier", "Price / month", "Product access", "Licensed Music Catalogue", "Allowances", "Status"].map((label) => (
                  <th key={label} scope="col" style={styles.th}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {publicPlans.map((plan) => {
                const cataloguePlan = findPublicPlan(plan.code);
                return (
                  <tr key={plan.id} style={styles.tr}>
                    <td style={styles.strongCell}>
                      <div>{plan.name}</div>
                      <div style={styles.code}>{plan.code}</div>
                      {cataloguePlan?.description ? <p style={styles.planDescription}>{cataloguePlan.description}</p> : null}
                    </td>
                    <td style={styles.td}>{PRODUCT_LABELS[plan.productFamily] || "Unclassified"}</td>
                    <td style={styles.td}>Tier {plan.tierNumber}</td>
                    <td style={styles.priceCell}>{formatPrice(plan)}</td>
                    <td style={styles.td}><ProductBadges plan={plan} /></td>
                    <td style={styles.td}>
                      <span style={plan.licensedMusicCatalogueLevel === "NONE" ? styles.noneBadge : styles.catalogueBadge}>
                        {plan.licensedMusicCatalogueLevel}
                      </span>
                    </td>
                    <td style={styles.allowances}>
                      {plan.stationLimit} station{plan.stationLimit === 1 ? "" : "s"}<br />
                      {plan.listenerLimit.toLocaleString()} listeners<br />
                      {plan.storageLimitGb.toLocaleString()} GB · {plan.maxBitrateKbps} kbps
                    </td>
                    <td style={styles.td}><span style={plan.active ? styles.activeBadge : styles.inactiveBadge}>{plan.active ? "Active" : "Inactive"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {legacyPlans.length > 0 ? (
        <section style={styles.section}>
          <div style={styles.sectionHeading}>
            <div>
              <p style={styles.kicker}>Migration safety</p>
              <h2 style={styles.sectionTitle}>Private and legacy plans</h2>
            </div>
          </div>
          <p style={styles.notice}>These records remain private. Stage 29R.2 does not infer Retail or Online access from an older generic subscription.</p>
          <div style={styles.legacyList}>
            {legacyPlans.map((plan) => (
              <article key={plan.id} style={styles.legacyCard}>
                <strong>{plan.name}</strong>
                <span style={styles.code}>{plan.code}</span>
                <ProductBadges plan={plan} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

const styles = {
  page: { maxWidth: 1320, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 22 },
  summaryCard: { display: "grid", gap: 4, padding: 18, border: "1px solid #cbd5e1", borderRadius: 12, background: "#fff" },
  summaryValue: { color: "#111827", fontSize: 28, fontWeight: 950 },
  summaryLabel: { color: "#64748b", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" },
  section: { marginTop: 20, padding: 22, border: "1px solid #cbd5e1", borderRadius: 14, background: "#f8fafc" },
  sectionHeading: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 },
  kicker: { margin: "0 0 5px", color: "#9a6400", fontSize: 11, fontWeight: 900, letterSpacing: ".8px", textTransform: "uppercase" },
  sectionTitle: { margin: 0, color: "#111827", fontSize: 21, fontWeight: 900 },
  readOnly: { borderRadius: 999, background: "#e2e8f0", color: "#334155", padding: "6px 10px", fontSize: 11, fontWeight: 850 },
  tableWrapper: { overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 10, background: "#fff" },
  table: { width: "100%", minWidth: 1260, borderCollapse: "collapse" },
  th: { padding: "12px 11px", borderBottom: "2px solid #94a3b8", background: "#e2e8f0", color: "#172033", fontSize: 12, fontWeight: 900, textAlign: "left", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #e2e8f0" },
  td: { padding: "14px 11px", color: "#334155", fontSize: 13, fontWeight: 650, verticalAlign: "top" },
  strongCell: { minWidth: 245, padding: "14px 11px", color: "#111827", fontSize: 14, fontWeight: 900, verticalAlign: "top" },
  priceCell: { padding: "14px 11px", color: "#7c4a00", fontSize: 14, fontWeight: 900, verticalAlign: "top", whiteSpace: "nowrap" },
  planDescription: { maxWidth: 290, margin: "7px 0 0", color: "#64748b", fontSize: 11, fontWeight: 550, lineHeight: 1.45 },
  code: { marginTop: 3, color: "#64748b", fontFamily: "monospace", fontSize: 10, fontWeight: 700 },
  badges: { display: "flex", flexWrap: "wrap", gap: 4, minWidth: 180 },
  includedBadge: { borderRadius: 999, background: "#dcfce7", color: "#166534", padding: "4px 7px", fontSize: 10, fontWeight: 850 },
  excludedBadge: { borderRadius: 999, background: "#f1f5f9", color: "#64748b", padding: "4px 7px", fontSize: 10, fontWeight: 750 },
  catalogueBadge: { display: "inline-block", borderRadius: 999, background: "#fef3c7", color: "#854d0e", padding: "5px 8px", fontSize: 10, fontWeight: 900 },
  noneBadge: { display: "inline-block", borderRadius: 999, background: "#f1f5f9", color: "#64748b", padding: "5px 8px", fontSize: 10, fontWeight: 850 },
  activeBadge: { display: "inline-block", borderRadius: 999, background: "#dcfce7", color: "#166534", padding: "5px 8px", fontSize: 10, fontWeight: 850 },
  inactiveBadge: { display: "inline-block", borderRadius: 999, background: "#fee2e2", color: "#991b1b", padding: "5px 8px", fontSize: 10, fontWeight: 850 },
  allowances: { minWidth: 150, padding: "14px 11px", color: "#475569", fontSize: 12, fontWeight: 650, lineHeight: 1.55, verticalAlign: "top" },
  notice: { margin: "-3px 0 14px", color: "#64748b", fontSize: 13, lineHeight: 1.5 },
  legacyList: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 },
  legacyCard: { display: "grid", gap: 7, padding: 14, border: "1px solid #dbe3ec", borderRadius: 10, background: "#fff" }
};
