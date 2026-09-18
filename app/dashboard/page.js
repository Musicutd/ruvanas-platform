import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEffectivePlan, resolveEntitlements } from "@/lib/entitlements.mjs";
import { prisma } from "@/lib/prisma";
import { buildSubscriberNavigation, buildSubscriberProductCards } from "@/lib/user-experience-navigation.mjs";
import { buildSubscriberOnboarding } from "@/lib/subscriber-onboarding.mjs";
import { buildSubscriberHome } from "@/lib/subscriber-home.mjs";
import ContextHelp from "@/app/components/ContextHelp";
import OnboardingChecklist from "@/app/components/OnboardingChecklist";
import SkipLink from "@/app/components/SkipLink";
import OrganisationSwitcher from "./OrganisationSwitcher";
import DashboardHomeTabs from "./DashboardHomeTabs";
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
  const hasPhysicalProduct = ["retailRadioEnabled", "schoolRadioEnabled", "healthRadioEnabled", "faithRadioEnabled", "organisationsEnabled"]
    .some((capability) => entitlements[capability]);
  const onlineOnly = entitlements.onlineRadioEnabled && !hasPhysicalProduct;
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE") || organisation.stations[0] || null;
  const now = new Date();

  const [activePlayerStreams, configuredPlayerCount, activeMusicModeCount, publishedScheduleCount, publicListeners] = await Promise.all([
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
    }),
    onlineOnly
      ? prisma.publicListenerLease.count({ where: { organisationId: organisation.id, expiresAt: { gt: now } } })
      : Promise.resolve(0)
  ]);

  const storageUsedMb = organisation.stations.reduce(
    (total, station) => total + station.storageUsedMb,
    0
  );
  const navigation = buildSubscriberNavigation({
    entitlements,
    firstStationId: firstStation?.id || null
  });
  const products = buildSubscriberProductCards({ entitlements });
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
  const home = buildSubscriberHome({ products, onboarding, serviceEnabled: entitlements.serviceEnabled });
  const nextAction = home.nextAction;
  const allNavigationItems = navigation.flatMap((section) => section.items);
  const quickActionIds = [
    "station",
    ...(hasPhysicalProduct ? ["players"] : []),
    "media",
    entitlements.schoolRadioEnabled ? "school" : "sessions",
    "notifications"
  ];
  const quickActions = quickActionIds
    .map((id) => allNavigationItems.find((item) => item.id === id))
    .filter(Boolean);
  const storageUsedGb = storageUsedMb / 1024;
  const setupProgress = home.onboarding ? usagePercent(onboarding.completedCount, onboarding.totalCount) : 0;
  const playerUsage = usagePercent(configuredPlayerCount, entitlements.streamLimit);
  const liveUsage = onlineOnly
    ? usagePercent(publicListeners, entitlements.listenerLimit)
    : usagePercent(activePlayerStreams, entitlements.streamLimit);
  const storageUsage = usagePercent(storageUsedGb, entitlements.storageLimitGb);

  return (
    <main className={styles.page}>
      <SkipLink />
      <div className={styles.shell} id="main-content">
        <section className={styles.welcome} aria-labelledby="dashboard-title">
          <div>
            <p className={styles.eyebrow}>SUBSCRIBER PORTAL</p>
            <h1 id="dashboard-title">Hello {user.name || "there"}</h1>
            <p>{home.description}</p>
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

        <DashboardHomeTabs>
          <div>

        <div className={styles.overviewGrid}>
          <section className={styles.nextAction} aria-labelledby="next-action-title">
            <div className={styles.nextActionCopy}>
              <p className={styles.eyebrow}>{nextAction.eyebrow}</p>
              <h2 id="next-action-title">{nextAction.title}</h2>
              <p>{nextAction.description}</p>
            </div>
            <div className={styles.nextActionFooter}>
              {home.onboarding ? <div className={styles.progressSummary}>
                <span>{onboarding.completedCount} of {onboarding.totalCount} setup checks complete</span>
                <progress value={onboarding.completedCount} max={onboarding.totalCount} aria-label={`${setupProgress}% of setup complete`} />
              </div> : null}
              <Link href={nextAction.href} className={styles.primaryButton}>{nextAction.label}</Link>
            </div>
          </section>

          <aside className={styles.servicePulse} aria-labelledby="service-pulse-title">
            <div className={styles.pulseHeader}>
              <div>
                <p className={styles.eyebrow}>SERVICE PULSE</p>
                <h2 id="service-pulse-title">Service access</h2>
              </div>
              <span className={entitlements.serviceEnabled ? styles.pulseDotHealthy : styles.pulseDotAttention} aria-hidden="true" />
            </div>
            <strong className={entitlements.serviceEnabled ? styles.pulseHealthy : styles.pulseAttention}>
              {entitlements.serviceEnabled ? "Plan available" : "Action needed"}
            </strong>
            <dl className={styles.pulseRows}>
              <div><dt>Plan</dt><dd>{plan?.name || "Trial"}</dd></div>
              {onlineOnly ? <div><dt>Public listeners</dt><dd>{publicListeners} of {entitlements.listenerLimit}</dd></div> : <div><dt>Live streams</dt><dd>{activePlayerStreams} of {entitlements.streamLimit}</dd></div>}
              {onlineOnly ? <div><dt>Stations</dt><dd>{organisation.stations.length}</dd></div> : <div><dt>Players ready</dt><dd>{configuredPlayerCount}</dd></div>}
            </dl>
          </aside>
        </div>

        {home.onboarding ? <OnboardingChecklist onboarding={home.onboarding} /> : null}

          </div>

          <div>

        <section className={styles.productSection} aria-labelledby="product-dashboard-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>YOUR RUVANAS PRODUCTS</p>
              <h2 id="product-dashboard-title">Choose a dashboard</h2>
            </div>
          </div>
          <div className={styles.productGrid}>
            {products.map((product) => (
              <Link href={product.actionHref} key={product.id} className={product.available ? styles.productCard : styles.productCardLocked}>
                <div className={styles.productCardTop}>
                  <span>{product.symbol}</span>
                  <small>{product.status}</small>
                </div>
                <strong>{product.label}</strong>
                <p>{product.description}</p>
                <b>{product.available ? "Open dashboard →" : "Review plans →"}</b>
              </Link>
            ))}
          </div>
        </section>

          </div>

          <div>

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
            {hasPhysicalProduct ? <article>
              <span>Players ready</span>
              <strong>{configuredPlayerCount} / {entitlements.streamLimit}</strong>
              <small>Secure players prepared</small>
              <progress value={playerUsage} max="100" aria-label={`${playerUsage}% of player allowance used`} />
            </article> : null}
            <article>
              <span>Live now</span>
              <strong>{onlineOnly ? publicListeners : activePlayerStreams} / {onlineOnly ? entitlements.listenerLimit : entitlements.streamLimit}</strong>
              <small>{onlineOnly ? "Public listeners connected" : "Stream slots in use"}</small>
              <progress value={liveUsage} max="100" aria-label={`${liveUsage}% of ${onlineOnly ? "public listener" : "live stream"} allowance used`} />
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
          introduction="You do not need to configure the whole platform at once. Open a product dashboard to find the setup steps that apply to it."
          items={[
            { title: "Your tasks", description: "Open your product dashboard to see the next setup step and the tools you can use." },
            { title: "Help with setup", description: "Your product dashboard explains its own content, programming and playback steps." },
            { title: "Check the result", description: "A setup step is complete only when the service has recorded the required configuration or activity." }
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
        </DashboardHomeTabs>
      </div>
    </main>
  );
}

