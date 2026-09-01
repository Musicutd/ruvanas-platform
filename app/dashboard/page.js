import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import {
  buildSubscriberNavigation,
  resolveDashboardNextAction
} from "@/lib/user-experience-navigation.mjs";
import OrganisationSwitcher from "./OrganisationSwitcher";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { orderBy: { createdAt: "asc" } }
  });

  if (!context) redirect("/login");

  const { user, membership, memberships } = context;
  if (user.role === "STUDENT") redirect("/school-student");
  if (!membership) redirect("/register");

  const organisation = membership.organisation;
  const subscription = organisation.subscription;
  const plan = subscription?.plan;
  const entitlements = resolveEntitlements(subscription);
  const firstStation = organisation.stations[0] || null;
  const now = new Date();

  const [activePlayerStreams, configuredPlayerCount] = await Promise.all([
    prisma.playerListenerLease.count({
      where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } }
    }),
    prisma.player.count({
      where: { organisationId: organisation.id, status: { not: "DISABLED" } }
    })
  ]);

  const storageUsedMb = organisation.stations.reduce(
    (total, station) => total + station.storageUsedMb,
    0
  );
  const navigation = buildSubscriberNavigation({
    entitlements,
    firstStationId: firstStation?.id || null
  });
  const nextAction = resolveDashboardNextAction({
    serviceEnabled: entitlements.serviceEnabled,
    stationCount: organisation.stations.length,
    configuredPlayerCount,
    activePlayerStreams
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <div className={styles.accountArea}>
          <span className={styles.accountLabel}>{organisation.name}</span>
          <form action="/api/auth/logout" method="post">
            <button className={styles.signOut} type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <div className={styles.shell}>
        <section className={styles.welcome} aria-labelledby="dashboard-title">
          <div>
            <p className={styles.eyebrow}>YOUR RUVANAS HOME</p>
            <h1 id="dashboard-title">Hello {user.name || "there"}</h1>
            <p>Everything you need to run your radio, organised around the jobs you do.</p>
          </div>
          <span className={styles.roleBadge}>{membership.role.replaceAll("_", " ").toLowerCase()}</span>
        </section>

        <OrganisationSwitcher
          organisations={memberships.map((item) => ({
            id: item.organisation.id,
            name: item.organisation.name
          }))}
          activeOrganisationId={organisation.id}
        />

        <section className={styles.nextAction} aria-labelledby="next-action-title">
          <div>
            <p className={styles.eyebrow}>{nextAction.eyebrow}</p>
            <h2 id="next-action-title">{nextAction.title}</h2>
            <p>{nextAction.description}</p>
          </div>
          <Link href={nextAction.href} className={styles.primaryButton}>{nextAction.label}</Link>
        </section>

        <section className={styles.statusSection} aria-labelledby="service-status-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>AT A GLANCE</p>
              <h2 id="service-status-title">Your service today</h2>
            </div>
            <span className={entitlements.serviceEnabled ? styles.healthy : styles.attention}>
              {entitlements.serviceEnabled ? "Service available" : "Needs attention"}
            </span>
          </div>
          <div className={styles.statusGrid}>
            <article>
              <span>Plan</span>
              <strong>{plan?.name || "Trial"}</strong>
              <small>{subscription?.status === "TRIAL" ? "Trial active" : subscription?.status || "No active plan"}</small>
            </article>
            <article>
              <span>Shop players</span>
              <strong>{configuredPlayerCount} / {entitlements.streamLimit}</strong>
              <small>Secure players prepared</small>
            </article>
            <article>
              <span>Live now</span>
              <strong>{activePlayerStreams} / {entitlements.streamLimit}</strong>
              <small>Stream slots in use</small>
            </article>
            <article>
              <span>Audio storage</span>
              <strong>{(storageUsedMb / 1024).toFixed(2)} GB</strong>
              <small>of {entitlements.storageLimitGb} GB available</small>
            </article>
          </div>
        </section>

        <section className={styles.toolsSection} aria-labelledby="tools-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>YOUR TOOLS</p>
              <h2 id="tools-title">What would you like to do?</h2>
            </div>
          </div>
          <div className={styles.navigationGrid}>
            {navigation.map((section) => (
              <article key={section.id} className={styles.navigationSection}>
                <h3>{section.label}</h3>
                <p>{section.description}</p>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href}>
                        <strong>{item.label}</strong>
                        <span>{item.description}</span>
                        <b aria-hidden="true">→</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <details className={styles.planDetails}>
          <summary>View plan and technical limits</summary>
          <div>
            <span>Stations <strong>{organisation.stations.length} / {entitlements.stationLimit}</strong></span>
            <span>Listener capacity <strong>{entitlements.listenerLimit}</strong></span>
            <span>Maximum quality <strong>{entitlements.maxBitrateKbps} kbps</strong></span>
          </div>
        </details>
      </div>
    </main>
  );
}
