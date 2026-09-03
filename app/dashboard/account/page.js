import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEffectivePlan, resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import {
  canViewSubscriberBilling,
  formatSubscriberCurrency,
  subscriberAccessPresentation,
  subscriberInvoicePresentation,
  subscriberPlanFeatures,
  subscriberUsageMeter
} from "@/lib/subscriber-account.mjs";
import styles from "./subscriber-account.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account & plan | Ruvanas" };

function displayDate(value) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-MT", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function Meter({ label, value, limit, detail }) {
  const meter = subscriberUsageMeter(value, limit);
  return (
    <article className={styles.meterCard}>
      <div className={styles.meterHeading}>
        <span>{label}</span>
        <strong>{meter.value} / {meter.limit}</strong>
      </div>
      <progress value={meter.percent} max="100" aria-label={`${label}: ${meter.percent}% used`} />
      <small>{meter.exceeded ? "Allowance exceeded — contact Ruvanas" : detail}</small>
    </article>
  );
}

export default async function SubscriberAccountPage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { select: { id: true, status: true, storageUsedMb: true } },
    locations: { select: { id: true, status: true } }
  });

  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const { membership } = context;
  const organisation = membership.organisation;
  const subscription = organisation.subscription;
  const plan = resolveEffectivePlan(subscription);
  const entitlements = resolveEntitlements(subscription);
  const access = subscriberAccessPresentation(entitlements);
  const mayViewBilling = canViewSubscriberBilling(membership.role);
  const now = new Date();

  const [playerCount, activeStreamCount, invoices] = await Promise.all([
    prisma.player.count({
      where: { organisationId: organisation.id, status: { not: "DISABLED" } }
    }),
    prisma.playerListenerLease.count({
      where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } }
    }),
    mayViewBilling
      ? prisma.billingInvoice.findMany({
          where: { organisationId: organisation.id },
          orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            status: true,
            currency: true,
            amountDueCents: true,
            amountPaidCents: true,
            periodStart: true,
            periodEnd: true,
            dueAt: true,
            paidAt: true
          }
        })
      : Promise.resolve([])
  ]);

  const storageUsedGb = organisation.stations.reduce(
    (total, station) => total + Number(station.storageUsedMb || 0),
    0
  ) / 1024;
  const storageMeter = subscriberUsageMeter(storageUsedGb, entitlements.storageLimitGb);
  const features = subscriberPlanFeatures(entitlements);
  const periodEnd = subscription?.billingContract?.currentPeriodEnd || subscription?.currentPeriodEnd;
  const monthlyPrice = plan && !entitlements.complimentaryAccess
    ? formatSubscriberCurrency(plan.monthlyPriceCents)
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.topNav} aria-label="Account navigation">
          <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
          <div>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/dashboard/team">Team</Link>
            <Link href="/dashboard/help">Help</Link>
          </div>
        </nav>

        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>ACCOUNT & PLAN</p>
            <h1>Your Ruvanas service</h1>
            <p>Understand your access, allowances and account records without technical billing language.</p>
          </div>
          <span className={styles.roleBadge}>{membership.role.replaceAll("_", " ").toLowerCase()}</span>
        </header>

        <section className={styles.overviewGrid} aria-label="Account overview">
          <article className={styles.planCard}>
            <div className={styles.planTitle}>
              <div>
                <p className={styles.eyebrow}>CURRENT PLAN</p>
                <h2>{plan?.name || "Plan not assigned"}</h2>
              </div>
              <span data-tone={access.tone}>{access.label}</span>
            </div>
            <p>{access.description}</p>
            <dl className={styles.planFacts}>
              <div><dt>Organisation</dt><dd>{organisation.name}</dd></div>
              <div><dt>Service period</dt><dd>{displayDate(periodEnd)}</dd></div>
              <div>
                <dt>Plan arrangement</dt>
                <dd>{entitlements.complimentaryAccess ? "Complimentary — no charge" : monthlyPrice ? `${monthlyPrice} monthly` : "Contact Ruvanas"}</dd>
              </div>
            </dl>
            {subscription?.billingContract?.cancelAtPeriodEnd ? (
              <div className={styles.accountNotice}>This plan is scheduled to end after the current service period.</div>
            ) : null}
          </article>

          <aside className={styles.contactCard}>
            <p className={styles.eyebrow}>PLAN SUPPORT</p>
            <h2>Need a change?</h2>
            <p>Ask Ruvanas about more locations, a different platform, account access or a service-plan review.</p>
            <Link href="/dashboard/support">Contact support</Link>
            {entitlements.complimentaryAccess ? <Link href="/dashboard/complimentary-access" className={styles.secondaryLink}>Review complimentary access</Link> : null}
          </aside>
        </section>

        <section className={styles.section} aria-labelledby="allowances-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>LIVE ALLOWANCES</p>
              <h2 id="allowances-title">What your plan supports</h2>
            </div>
            <span>{organisation.locations.filter((location) => location.status === "ACTIVE").length} active locations</span>
          </div>
          <div className={styles.meterGrid}>
            <Meter label="Stations" value={organisation.stations.length} limit={entitlements.stationLimit} detail="Radio services configured" />
            <Meter label="Players" value={playerCount} limit={entitlements.streamLimit} detail="Secure devices prepared" />
            <Meter label="Live streams" value={activeStreamCount} limit={entitlements.streamLimit} detail="Concurrent stream slots in use" />
            <article className={styles.meterCard}>
              <div className={styles.meterHeading}><span>Audio storage</span><strong>{storageUsedGb.toFixed(2)} / {entitlements.storageLimitGb} GB</strong></div>
              <progress value={storageMeter.percent} max="100" aria-label={`Audio storage: ${storageMeter.percent}% used`} />
              <small>{storageMeter.exceeded ? "Allowance exceeded — contact Ruvanas" : "Protected audio stored for this organisation"}</small>
            </article>
          </div>
          <div className={styles.technicalFacts}>
            <span>Listener capacity <strong>{entitlements.listenerLimit.toLocaleString("en-MT")}</strong></span>
            <span>Maximum audio quality <strong>{entitlements.maxBitrateKbps} kbps</strong></span>
            <span>Simultaneous services <strong>{entitlements.simultaneousStreamsEnabled ? "Enabled" : "One stream"}</strong></span>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>PLATFORM ACCESS</p>
              <h2 id="features-title">Included products and tools</h2>
            </div>
          </div>
          <div className={styles.featureGrid}>
            {features.map((feature) => (
              <article key={feature.label} data-enabled={feature.enabled}>
                <span aria-hidden="true">{feature.enabled ? "✓" : "—"}</span>
                <div><strong>{feature.label}</strong><small>{feature.enabled ? "Included in your current access" : "Not included in this plan"}</small></div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="billing-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>ACCOUNT RECORDS</p>
              <h2 id="billing-title">Billing history</h2>
            </div>
            <span>Owner-only details</span>
          </div>
          {!mayViewBilling ? (
            <div className={styles.restricted}>
              <strong>Financial details are limited to the organisation owner.</strong>
              <p>You can still see the plan, service status and operational allowances above.</p>
            </div>
          ) : entitlements.complimentaryAccess ? (
            <div className={styles.restricted}>
              <strong>No subscription charge applies.</strong>
              <p>This account is using Ruvanas-issued complimentary access until it is stopped by Ruvanas.</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className={styles.restricted}>
              <strong>No billing records are available yet.</strong>
              <p>Account records will appear here when they are issued.</p>
            </div>
          ) : (
            <div className={styles.invoiceList}>
              {invoices.map((invoice) => {
                const presentation = subscriberInvoicePresentation(invoice);
                return (
                  <article key={invoice.id}>
                    <div>
                      <strong>{displayDate(invoice.periodStart)} – {displayDate(invoice.periodEnd)}</strong>
                      <small>{invoice.paidAt ? `Paid ${displayDate(invoice.paidAt)}` : invoice.dueAt ? `Due ${displayDate(invoice.dueAt)}` : "Account record"}</small>
                    </div>
                    <div className={styles.invoiceAmount}>
                      <strong>{formatSubscriberCurrency(invoice.amountDueCents, invoice.currency)}</strong>
                      <span data-tone={presentation.tone}>{presentation.label}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <strong>Safe account visibility</strong>
          <span>Ruvanas never shows payment-provider identifiers or administration controls in the subscriber portal.</span>
        </footer>
      </div>
    </main>
  );
}
