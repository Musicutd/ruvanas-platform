import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEffectivePlan, resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { buildSubscriberNavigation } from "@/lib/user-experience-navigation.mjs";
import { buildSubscriberOnboarding } from "@/lib/subscriber-onboarding.mjs";
import ContextHelp from "@/app/components/ContextHelp";
import OnboardingChecklist from "@/app/components/OnboardingChecklist";
import SkipLink from "@/app/components/SkipLink";
import OrganisationSwitcher from "./OrganisationSwitcher";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

function usagePercent(value, limit) {
  if (!limit || limit < 1) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

const quickActionSymbols = {
  station: "ON AIR",
  players: "PLAY",
  media: "AUDIO",
  school: "SCHOOL",
  sessions: "LIVE",
  notifications: "UPDATES"
};

export default async function DashboardPage() {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    stations: { orderBy: { createdAt: "asc" } },
    locations: { select: { id: true, status: true } }
  });

  if (!context) redirect("/login");

  const { user, membership, memberships } = context;
  if (user.role === "STUDENT") redirect("/school-student");
  if (!membership) redirect("/register");

  const organisation = membership.organisation;
  const subscription = organisation.subscription;
  const plan = resolveEffectivePlan(subscription);
  const entitlements = resolveEntitlements(subscription);
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE") || organisation.stations[0] || null;
  const now = new Date();

  const [activePlayerStreams, configuredPlayerCount, activeMusicModeCount, publishedScheduleCount] = await Promise.all([
    prisma.playerListenerLease.count({
      where: { organisationId: organisation.id, revokedAt: null, expiresAt: { gt: now } }
    }),
    prisma.player.count({
      where: { organisationId: organisation.id, status: { not: "DISABLED" } }
    }),
    prisma.musicMode.count({
      where: { organisationId: organisation.id, status: "ACTIVE" }
    }),
    prisma.musicSchedule.count({
      where: { organisationId: organisation.id, status: "PUBLISHED" }
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
  const onboarding = buildSubscriberOnboarding({
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: membership.role,
    firstStationId: firstStation?.id || null,
    stationReady: firstStation?.status === "ACTIVE",
    activeLocationCount: organisation.locations.filter((location) => location.status === "ACTIVE").length,
    activeMusicModeCount,
    publishedScheduleCount,
    configuredPlayerCount,
    activePlayerStreams
  });
  const nextAction = onboarding.nextAction;
  const allNavigationItems = navigation.flatMap((section) => section.items);
  const quickActionIds = [
    "station",
    "players",
    "media",
    entitlements.schoolRadioEnabled ? "school" : "sessions",
    "notifications"
  ];
  const quickActions = quickActionIds
    .map((id) => allNavigationItems.find((item) => item.id === id))
    .filter(Boolean);
  const storageUsedGb = storageUsedMb / 1024;
  const setupProgress = usagePercent(onboarding.completedCount, onboarding.totalCount);
  const playerUsage = usagePercent(configuredPlayerCount, entitlements.streamLimit);
  const liveUsage = usagePercent(activePlayerStreams, entitlements.streamLimit);
  const storageUsage = usagePercent(storageUsedGb, entitlements.storageLimitGb);

  return (
    <main className={styles.page}>
      <SkipLink />
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <nav className={styles.headerNav} aria-label="Portal navigation">
          <Link href="/dashboard" aria-current="page">Home</Link>
          <Link href="/dashboard/help">Help</Link>
          <Link href="/dashboard/support">Support</Link>
        </nav>
        <div className={styles.accountArea}>
          <span className={styles.accountLabel}>{organisation.name}</span>
          <form action="/api/auth/logout" method="post">
            <button className={styles.signOut} type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <div className={styles.shell} id="main-content">
        <section className={styles.welcome} aria-labelledby="dashboard-title">
          <div>
            <p className={styles.eyebrow}>SUBSCRIBER PORTAL</p>
            <h1 id="dashboard-title">Hello {user.name || "there"}</h1>
            <p>Your radio service, daily tasks and support in one clear place.</p>
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

        <div className={styles.overviewGrid}>
          <section className={styles.nextAction} aria-labelledby="next-action-title">
            <div className={styles.nextActionCopy}>
              <p className={styles.eyebrow}>{nextAction.eyebrow}</p>
              <h2 id="next-action-title">{nextAction.title}</h2>
              <p>{nextAction.description}</p>
            </div>
            <div className={styles.nextActionFooter}>
              <div className={styles.progressSummary}>
                <span>{onboarding.completedCount} of {onboarding.totalCount} setup checks complete</span>
                <progress value={onboarding.completedCount} max={onboarding.totalCount} aria-label={`${setupProgress}% of setup complete`} />
              </div>
              <Link href={nextAction.href} className={styles.primaryButton}>{nextAction.label}</Link>
            </div>
          </section>

          <aside className={styles.servicePulse} aria-labelledby="service-pulse-title">
            <div className={styles.pulseHeader}>
              <div>
                <p className={styles.eyebrow}>SERVICE PULSE</p>
                <h2 id="service-pulse-title">Radio status</h2>
              </div>
              <span className={entitlements.serviceEnabled ? styles.pulseDotHealthy : styles.pulseDotAttention} aria-hidden="true" />
            </div>
            <strong className={entitlements.serviceEnabled ? styles.pulseHealthy : styles.pulseAttention}>
              {entitlements.serviceEnabled ? "Available" : "Action needed"}
            </strong>
            <dl className={styles.pulseRows}>
              <div><dt>Plan</dt><dd>{plan?.name || "Trial"}</dd></div>
              <div><dt>Live streams</dt><dd>{activePlayerStreams} of {entitlements.streamLimit}</dd></div>
              <div><dt>Players ready</dt><dd>{configuredPlayerCount}</dd></div>
            </dl>
          </aside>
        </div>

        <OnboardingChecklist onboarding={onboarding} />

        <section className={styles.quickSection} aria-labelledby="quick-actions-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>QUICK ACTIONS</p>
              <h2 id="quick-actions-title">Where do you want to go?</h2>
            </div>
          </div>
          <div className={styles.quickGrid}>
            {quickActions.map((item) => (
              <Link href={item.href} key={item.id} className={styles.quickCard}>
                <span className={styles.quickSymbol}>{quickActionSymbols[item.id] || "OPEN"}</span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
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
              <small>{entitlements.complimentaryAccess ? "Complimentary access — no charge" : subscription?.status === "TRIAL" ? "Trial active" : subscription?.status || "No active plan"}</small>
            </article>
            <article>
              <span>Players ready</span>
              <strong>{configuredPlayerCount} / {entitlements.streamLimit}</strong>
              <small>Secure players prepared</small>
              <progress value={playerUsage} max="100" aria-label={`${playerUsage}% of player allowance used`} />
            </article>
            <article>
              <span>Live now</span>
              <strong>{activePlayerStreams} / {entitlements.streamLimit}</strong>
              <small>Stream slots in use</small>
              <progress value={liveUsage} max="100" aria-label={`${liveUsage}% of live stream allowance used`} />
            </article>
            <article>
              <span>Audio storage</span>
              <strong>{storageUsedGb.toFixed(2)} GB</strong>
              <small>of {entitlements.storageLimitGb} GB available</small>
              <progress value={storageUsage} max="100" aria-label={`${storageUsage}% of audio storage used`} />
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
            {navigation.map((section, sectionIndex) => (
              <article key={section.id} className={styles.navigationSection}>
                <div className={styles.navigationTitle}>
                  <span aria-hidden="true">{String(sectionIndex + 1).padStart(2, "0")}</span>
                  <h3>{section.label}</h3>
                </div>
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

        <ContextHelp
          title="Need a hand? Open quick help"
          introduction="You do not need to configure the whole platform at once. The setup guide always points to the first unfinished step."
          items={[
            { title: "Your tasks", description: "Owners and managers create the station and securely enrol each player." },
            { title: "Ruvanas-managed setup", description: "Locations, approved music modes and published schedules are prepared through controlled administration." },
            { title: "Live confirmation", description: "A step becomes complete only when the system has real configuration or active-player evidence." }
          ]}
          articleHref="/dashboard/help#getting-started"
          articleLabel="Open the getting-started guide"
        />

        <details className={styles.planDetails}>
          <summary>View plan and technical limits</summary>
          <div>
            {entitlements.complimentaryAccess ? <span>Access <strong>Complimentary until stopped by Ruvanas</strong></span> : null}
            <span>Stations <strong>{organisation.stations.length} / {entitlements.stationLimit}</strong></span>
            <span>Listener capacity <strong>{entitlements.listenerLimit}</strong></span>
            <span>Maximum quality <strong>{entitlements.maxBitrateKbps} kbps</strong></span>
          </div>
        </details>
      </div>
    </main>
  );
}
