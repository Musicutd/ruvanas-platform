import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { buildAdminNavigation } from "@/lib/user-experience-navigation.mjs";
import styles from "./admin-dashboard.module.css";

export const dynamic = "force-dynamic";

const DAY_COUNT = 14;
const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;
const PLOT = { left: 54, right: 730, top: 22, bottom: 202 };

function utcDayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function dayLabel(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function buildDailySeries(rows, startDate) {
  const totals = new Map();
  for (const row of rows) {
    const key = utcDayKey(row.bucketStart);
    totals.set(key, (totals.get(key) || 0) + (row._sum.playbackCompletedCount || 0));
  }

  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const day = new Date(startDate);
    day.setUTCDate(day.getUTCDate() + index);
    const key = utcDayKey(day);
    return { key, label: dayLabel(key), value: totals.get(key) || 0 };
  });
}

function chartGeometry(series) {
  const maximum = Math.max(1, ...series.map((item) => item.value));
  const plotWidth = PLOT.right - PLOT.left;
  const plotHeight = PLOT.bottom - PLOT.top;
  const points = series.map((item, index) => {
    const x = PLOT.left + (index / Math.max(1, series.length - 1)) * plotWidth;
    const y = PLOT.bottom - (item.value / maximum) * plotHeight;
    return { ...item, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length
    ? `M ${points[0].x} ${PLOT.bottom} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points.at(-1).x} ${PLOT.bottom} Z`
    : "";
  return { maximum, points, line, area };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value || 0);
}

export default async function AdminOverviewPage() {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");

  const now = new Date();
  const startDate = new Date(now);
  startDate.setUTCHours(0, 0, 0, 0);
  startDate.setUTCDate(startDate.getUTCDate() - (DAY_COUNT - 1));
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    organisationCount,
    activeSubscriptionCount,
    activeStationCount,
    configuredPlayerCount,
    onlinePlayerCount,
    liveStreamCount,
    openSupportCount,
    completedPlayback24h,
    activityRows,
    recentOrganisations
  ] = await Promise.all([
    prisma.organisation.count(),
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } }),
    prisma.station.count({ where: { status: "ACTIVE" } }),
    prisma.player.count({ where: { status: { not: "DISABLED" } } }),
    prisma.player.count({ where: { status: "ONLINE" } }),
    prisma.playerListenerLease.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } } }),
    prisma.proofOfPlayEvent.count({ where: { eventType: "COMPLETED", occurredAt: { gte: last24Hours } } }),
    prisma.analyticsHourlyAggregate.groupBy({
      by: ["bucketStart"],
      where: { bucketStart: { gte: startDate } },
      _sum: { playbackCompletedCount: true },
      orderBy: { bucketStart: "asc" }
    }),
    prisma.organisation.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { members: true, locations: true, stations: true, players: true } }
      }
    })
  ]);

  const series = buildDailySeries(activityRows, startDate);
  const chart = chartGeometry(series);
  const totalPlayback = series.reduce((sum, item) => sum + item.value, 0);
  const navigationItems = buildAdminNavigation(adminUser.role).flatMap((section) => section.items);
  const preferredActions = [
    "/admin/organisations",
    "/admin/players",
    "/admin/compliance",
    "/admin/operations"
  ];
  const quickActions = preferredActions
    .map((href) => navigationItems.find((item) => item.href === href))
    .filter(Boolean);
  const footprint = [
    { label: "Organisations", value: organisationCount, tone: "gold" },
    { label: "Active stations", value: activeStationCount, tone: "blue" },
    { label: "Configured players", value: configuredPlayerCount, tone: "green" },
    { label: "Online players", value: onlinePlayerCount, tone: "violet" }
  ];
  const footprintMaximum = Math.max(1, ...footprint.map((item) => item.value));

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="admin-overview-title">
        <div>
          <p className={styles.eyebrow}>PLATFORM COMMAND CENTRE</p>
          <h1 id="admin-overview-title">Good day, {adminUser.name || "Administrator"}</h1>
          <p>Monitor customers, radio delivery and operational work from one controlled overview.</p>
        </div>
        <div className={styles.heroActions}>
          {quickActions.slice(0, 2).map((item, index) => (
            <Link key={item.href} href={item.href} className={index === 0 ? styles.primaryAction : styles.secondaryAction}>
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.kpiGrid} aria-label="Platform summary">
        <article><span>Customer organisations</span><strong>{formatNumber(organisationCount)}</strong><small>{formatNumber(activeSubscriptionCount)} active or trial services</small></article>
        <article><span>Active stations</span><strong>{formatNumber(activeStationCount)}</strong><small>{formatNumber(liveStreamCount)} live player streams now</small></article>
        <article><span>Playback completed</span><strong>{formatNumber(completedPlayback24h)}</strong><small>Verified completions in the last 24 hours</small></article>
        <article className={openSupportCount > 0 ? styles.attentionKpi : ""}><span>Support requiring action</span><strong>{formatNumber(openSupportCount)}</strong><small>Open, active or waiting customer</small></article>
      </section>

      <div className={styles.analyticsGrid}>
        <section className={styles.chartCard} aria-labelledby="activity-chart-title">
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>DELIVERY ANALYTICS</p>
              <h2 id="activity-chart-title">Completed playback activity</h2>
              <p>Verified radio playback events across the platform during the last 14 days.</p>
            </div>
            <div className={styles.chartTotal}><strong>{formatNumber(totalPlayback)}</strong><span>14-day total</span></div>
          </div>
          <div className={styles.chartWrap}>
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby="playback-chart-title playback-chart-description">
              <title id="playback-chart-title">Completed playback activity over fourteen days</title>
              <desc id="playback-chart-description">A line chart showing the number of completed playback events for each day.</desc>
              <defs>
                <linearGradient id="activityArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#d99a24" stopOpacity=".3" />
                  <stop offset="100%" stopColor="#d99a24" stopOpacity=".02" />
                </linearGradient>
              </defs>
              {[0, .25, .5, .75, 1].map((ratio) => {
                const y = PLOT.bottom - ratio * (PLOT.bottom - PLOT.top);
                return <line key={ratio} x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className={styles.gridLine} />;
              })}
              <path d={chart.area} fill="url(#activityArea)" />
              <polyline points={chart.line} className={styles.chartLine} />
              {chart.points.map((point, index) => (
                <g key={point.key}>
                  <circle cx={point.x} cy={point.y} r="4" className={styles.chartPoint}>
                    <title>{point.label}: {formatNumber(point.value)} completed</title>
                  </circle>
                  {(index % 3 === 0 || index === chart.points.length - 1) ? (
                    <text x={point.x} y="232" textAnchor="middle" className={styles.axisLabel}>{point.label}</text>
                  ) : null}
                </g>
              ))}
            </svg>
          </div>
        </section>

        <section className={styles.footprintCard} aria-labelledby="footprint-title">
          <div className={styles.cardHeadingCompact}>
            <p className={styles.eyebrow}>PLATFORM FOOTPRINT</p>
            <h2 id="footprint-title">Service estate</h2>
            <p>Current configured and online resources.</p>
          </div>
          <div className={styles.footprintList}>
            {footprint.map((item) => (
              <div key={item.label}>
                <span><b>{item.label}</b><strong>{formatNumber(item.value)}</strong></span>
                <div className={styles.track}><i className={styles[item.tone]} style={{ width: `${Math.max(3, Math.round((item.value / footprintMaximum) * 100))}%` }} /></div>
              </div>
            ))}
          </div>
          <div className={styles.liveStatus}>
            <span className={liveStreamCount > 0 ? styles.liveDot : styles.idleDot} />
            <div><strong>{liveStreamCount > 0 ? "Live delivery active" : "No live sessions at this moment"}</strong><small>{formatNumber(onlinePlayerCount)} players currently report online</small></div>
          </div>
        </section>
      </div>

      <div className={styles.lowerGrid}>
        <section className={styles.recentCard} aria-labelledby="recent-organisations-title">
          <div className={styles.listHeading}>
            <div><p className={styles.eyebrow}>CUSTOMER ACTIVITY</p><h2 id="recent-organisations-title">Recently added organisations</h2></div>
            <Link href="/admin/organisations">View all</Link>
          </div>
          <div className={styles.organisationList}>
            {recentOrganisations.length ? recentOrganisations.map((organisation) => (
              <article key={organisation.id}>
                <div className={styles.organisationAvatar}>{organisation.name.slice(0, 2).toUpperCase()}</div>
                <div className={styles.organisationName}><strong>{organisation.name}</strong><span>{organisation.subscription?.plan?.name || "No plan assigned"}</span></div>
                <dl>
                  <div><dt>Locations</dt><dd>{organisation._count.locations}</dd></div>
                  <div><dt>Stations</dt><dd>{organisation._count.stations}</dd></div>
                  <div><dt>Players</dt><dd>{organisation._count.players}</dd></div>
                </dl>
              </article>
            )) : <p className={styles.empty}>No customer organisations have been created yet.</p>}
          </div>
        </section>

        <aside className={styles.quickCard} aria-labelledby="admin-quick-actions-title">
          <p className={styles.eyebrow}>QUICK ACCESS</p>
          <h2 id="admin-quick-actions-title">Daily operations</h2>
          <p>Open the areas most often used to support customers and monitor delivery.</p>
          <div>
            {quickActions.map((item) => <Link key={item.href} href={item.href}><span>{item.label}</span><b aria-hidden="true">→</b></Link>)}
          </div>
        </aside>
      </div>
    </div>
  );
}
