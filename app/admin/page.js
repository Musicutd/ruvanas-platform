import Link from "next/link";
import { redirect } from "next/navigation";
import { ADMIN_ANALYTICS_RANGES, normaliseAdminAnalyticsRange } from "@/lib/admin-analytics.mjs";
import { getAdminAnalyticsSnapshot } from "@/lib/admin-analytics-service";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import { buildAdminNavigation } from "@/lib/user-experience-navigation.mjs";
import styles from "./admin-dashboard.module.css";

export const dynamic = "force-dynamic";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;
const PLOT = { left: 54, right: 730, top: 22, bottom: 202 };

function dayLabel(value, range) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: range > 30 ? "numeric" : "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function chartPoints(series, field) {
  const maximum = Math.max(1, ...series.map((item) => item[field]));
  const plotWidth = PLOT.right - PLOT.left;
  const plotHeight = PLOT.bottom - PLOT.top;
  return series.map((item, index) => ({
    ...item,
    x: PLOT.left + (index / Math.max(1, series.length - 1)) * plotWidth,
    y: PLOT.bottom - (item[field] / maximum) * plotHeight
  }));
}

function polyline(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function areaPath(points) {
  if (!points.length) return "";
  return `M ${points[0].x} ${PLOT.bottom} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${points.at(-1).x} ${PLOT.bottom} Z`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(value || 0);
}

function changeLabel(change) {
  if (change.direction === "new") return "New activity in this period";
  if (change.direction === "steady") return "No change from previous period";
  return `${Math.abs(change.percentage)}% ${change.direction} from previous period`;
}

function heartbeatLabel(value) {
  if (!value) return "No heartbeat received";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AttentionItem({ tone, title, description, count, href, label }) {
  return (
    <article className={`${styles.attentionItem} ${styles[tone]}`}>
      <span className={styles.attentionCount}>{formatNumber(count)}</span>
      <div><strong>{title}</strong><p>{description}</p></div>
      <Link href={href}>{label}</Link>
    </article>
  );
}

function RankedList({ items, empty, href, valueLabel }) {
  if (!items.length) return <p className={styles.empty}>{empty}</p>;
  const maximum = Math.max(1, ...items.map((item) => item.completed));
  return <div className={styles.rankedList}>{items.map((item, index) => (
    <Link key={item.id} href={href} className={styles.rankedItem}>
      <span className={styles.rank}>{index + 1}</span>
      <span className={styles.rankedName}><strong>{item.name}</strong><small>{item.organisationName || `${formatNumber(item.failed)} failed or interrupted`}</small></span>
      <span className={styles.rankedValue}><strong>{formatNumber(item.completed)}</strong><small>{valueLabel}</small></span>
      <i><b style={{ width: `${Math.max(3, Math.round((item.completed / maximum) * 100))}%` }} /></i>
    </Link>
  ))}</div>;
}

export default async function AdminOverviewPage({ searchParams }) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");

  const params = await Promise.resolve(searchParams);
  const range = normaliseAdminAnalyticsRange(params?.range);
  const snapshot = await getAdminAnalyticsSnapshot(prisma, { range, includeRestrictedOperations: adminUser.role === "SUPER_ADMIN" });
  const playbackPoints = chartPoints(snapshot.series, "completed");
  const sessionPoints = chartPoints(snapshot.series, "sessionStarts");
  const navigationItems = buildAdminNavigation(adminUser.role).flatMap((section) => section.items);
  const preferredActions = ["/admin/organisations", "/admin/players", "/admin/compliance", "/admin/operations"];
  const quickActions = preferredActions.map((href) => navigationItems.find((item) => item.href === href)).filter(Boolean);
  const visibleAttention = adminUser.role === "SUPER_ADMIN"
    ? snapshot.attention
    : { ...snapshot.attention, deadLetterJobs: 0 };
  const attentionTotal = Object.values(visibleAttention).reduce((sum, value) => sum + value, 0);
  const serviceMaximum = Math.max(1, ...snapshot.serviceMix.map((item) => item.value));
  const labelEvery = range <= 14 ? 2 : range <= 30 ? 5 : 15;

  const alertItems = [
    snapshot.attention.offlinePlayers ? { tone: "critical", title: "Players need attention", description: "Enrolled players are offline or have stopped reporting.", count: snapshot.attention.offlinePlayers, href: "/admin/players", label: "Review players" } : null,
    snapshot.attention.playerIncidents ? { tone: "warning", title: "Player health incidents", description: "Open or acknowledged player incidents require follow-up.", count: snapshot.attention.playerIncidents, href: "/admin/players", label: "Open health desk" } : null,
    snapshot.attention.streamIncidents ? { tone: "warning", title: "Stream health incidents", description: "Station source health has unresolved operational incidents.", count: snapshot.attention.streamIncidents, href: "/admin/stations", label: "Review stations" } : null,
    snapshot.attention.openSupportTickets ? { tone: "neutral", title: "Support requests", description: "Customer requests are open, active or waiting for a response.", count: snapshot.attention.openSupportTickets, href: "/admin/compliance", label: "Open support" } : null,
    adminUser.role === "SUPER_ADMIN" && snapshot.attention.deadLetterJobs ? { tone: "critical", title: "Delivery jobs stopped", description: "Dead-letter jobs need a controlled operational retry.", count: snapshot.attention.deadLetterJobs, href: "/admin/jobs", label: "Review jobs" } : null
  ].filter(Boolean);

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="admin-overview-title">
        <div>
          <p className={styles.eyebrow}>PLATFORM COMMAND CENTRE</p>
          <h1 id="admin-overview-title">Good day, {adminUser.name || "Administrator"}</h1>
          <p>Monitor customers, delivery performance and operational work from one controlled overview.</p>
        </div>
        <div className={styles.heroActions}>
          <a href={`/api/admin/analytics/summary?range=${range}`} className={styles.secondaryAction}>Download report</a>
          {quickActions[0] ? <Link href={quickActions[0].href} className={styles.primaryAction}>{quickActions[0].label}</Link> : null}
        </div>
      </section>

      <section className={styles.controlBar} aria-label="Analytics controls">
        <div><strong>Reporting period</strong><span>{snapshot.filters.from} to {snapshot.filters.to}</span></div>
        <nav aria-label="Select reporting period">{ADMIN_ANALYTICS_RANGES.map((days) => (
          <Link key={days} href={`/admin?range=${days}`} className={days === range ? styles.activeRange : styles.range}>{days} days</Link>
        ))}</nav>
      </section>

      <section className={styles.kpiGrid} aria-label="Platform summary">
        <article><span>Customer organisations</span><strong>{formatNumber(snapshot.totals.organisations)}</strong><small>{formatNumber(snapshot.totals.activeSubscriptions)} active or trial services</small></article>
        <article><span>Active stations</span><strong>{formatNumber(snapshot.totals.activeStations)}</strong><small>{formatNumber(snapshot.totals.liveStreams)} live player streams now</small></article>
        <article><span>Completed playback</span><strong>{formatNumber(snapshot.periodTotals.completed)}</strong><small>{changeLabel(snapshot.changes.completed)}</small></article>
        <article className={attentionTotal > 0 ? styles.attentionKpi : ""}><span>Needs attention</span><strong>{formatNumber(attentionTotal)}</strong><small>{attentionTotal ? "Operational items across the platform" : "No open platform warnings"}</small></article>
      </section>

      <div className={styles.analyticsGrid}>
        <section className={styles.chartCard} aria-labelledby="activity-chart-title">
          <div className={styles.cardHeading}>
            <div><p className={styles.eyebrow}>DELIVERY ANALYTICS</p><h2 id="activity-chart-title">Playback and stream-session trend</h2><p>Daily relative trends for verified playback and newly started stream sessions.</p></div>
            <div className={styles.chartTotals}>
              <span><i className={styles.playbackLegend} /><b>{formatNumber(snapshot.periodTotals.completed)}</b> playback</span>
              <span><i className={styles.sessionLegend} /><b>{formatNumber(snapshot.periodTotals.sessionStarts)}</b> sessions</span>
            </div>
          </div>
          <Link href={`/admin/proof-of-play?range=${range}`} className={styles.chartLink} aria-label="Open detailed proof-of-play information">
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby="playback-chart-title playback-chart-description">
              <title id="playback-chart-title">Playback and stream-session activity over {range} days</title>
              <desc id="playback-chart-description">Two relative trend lines show completed playback and stream sessions started for each day. Open the chart for detailed proof of play.</desc>
              <defs><linearGradient id="activityArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d99a24" stopOpacity=".28" /><stop offset="100%" stopColor="#d99a24" stopOpacity=".02" /></linearGradient></defs>
              {[0, .25, .5, .75, 1].map((ratio) => { const y = PLOT.bottom - ratio * (PLOT.bottom - PLOT.top); return <line key={ratio} x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} className={styles.gridLine} />; })}
              <path d={areaPath(playbackPoints)} fill="url(#activityArea)" />
              <polyline points={polyline(playbackPoints)} className={styles.chartLine} />
              <polyline points={polyline(sessionPoints)} className={styles.sessionLine} />
              {playbackPoints.map((point, index) => (
                <g key={point.key}>
                  <circle cx={point.x} cy={point.y} r="3.5" className={styles.chartPoint}><title>{dayLabel(point.key, range)}: {formatNumber(point.completed)} completed</title></circle>
                  <circle cx={sessionPoints[index].x} cy={sessionPoints[index].y} r="3" className={styles.sessionPoint}><title>{dayLabel(point.key, range)}: {formatNumber(point.sessionStarts)} sessions started</title></circle>
                  {(index % labelEvery === 0 || index === playbackPoints.length - 1) ? <text x={point.x} y="232" textAnchor="middle" className={styles.axisLabel}>{dayLabel(point.key, range)}</text> : null}
                </g>
              ))}
            </svg>
            <span className={styles.chartDrilldown}>Open detailed playback evidence →</span>
          </Link>
        </section>

        <section className={styles.footprintCard} aria-labelledby="service-mix-title">
          <div className={styles.cardHeadingCompact}><p className={styles.eyebrow}>CUSTOMER MIX</p><h2 id="service-mix-title">Services in operation</h2><p>Active subscriptions grouped by primary platform.</p></div>
          <div className={styles.footprintList}>{snapshot.serviceMix.map((item, index) => (
            <div key={item.label}><span><b>{item.label}</b><strong>{formatNumber(item.value)}</strong></span><div className={styles.track}><i className={[styles.gold, styles.blue, styles.violet][index]} style={{ width: `${Math.max(3, Math.round((item.value / serviceMaximum) * 100))}%` }} /></div></div>
          ))}</div>
          <div className={styles.liveStatus}><span className={snapshot.totals.liveStreams > 0 ? styles.liveDot : styles.idleDot} /><div><strong>{snapshot.totals.liveStreams > 0 ? "Live delivery active" : "No live sessions at this moment"}</strong><small>{formatNumber(snapshot.totals.onlinePlayers)} of {formatNumber(snapshot.totals.configuredPlayers)} configured players report online</small></div></div>
        </section>
      </div>

      <section className={styles.attentionCard} aria-labelledby="attention-title">
        <div className={styles.listHeading}><div><p className={styles.eyebrow}>NEEDS ATTENTION</p><h2 id="attention-title">Operational action centre</h2></div><span>{alertItems.length ? `${alertItems.length} action groups` : "All clear"}</span></div>
        {alertItems.length ? <div className={styles.attentionList}>{alertItems.map((item) => <AttentionItem key={item.title} {...item} />)}</div> : <div className={styles.allClear}><span>✓</span><div><strong>No active platform warnings</strong><p>Players, streams, support and background delivery have no open alerts.</p></div></div>}
      </section>

      <div className={styles.rankingGrid}>
        <section className={styles.rankingCard} aria-labelledby="top-organisations-title">
          <div className={styles.listHeading}><div><p className={styles.eyebrow}>CUSTOMER ANALYTICS</p><h2 id="top-organisations-title">Top organisations</h2></div><Link href="/admin/organisations">View customers</Link></div>
          <RankedList items={snapshot.topOrganisations} empty="No organisation playback activity in this period." href="/admin/organisations" valueLabel="completed" />
        </section>
        <section className={styles.rankingCard} aria-labelledby="top-stations-title">
          <div className={styles.listHeading}><div><p className={styles.eyebrow}>STATION ANALYTICS</p><h2 id="top-stations-title">Top stations</h2></div><Link href="/admin/stations">View stations</Link></div>
          <RankedList items={snapshot.topStations} empty="No station-attributed playback activity in this period." href="/admin/stations" valueLabel="completed" />
        </section>
      </div>

      <div className={styles.lowerGrid}>
        <section className={styles.recentCard} aria-labelledby="offline-players-title">
          <div className={styles.listHeading}><div><p className={styles.eyebrow}>PLAYER AVAILABILITY</p><h2 id="offline-players-title">Players requiring follow-up</h2></div><Link href="/admin/players">Open health desk</Link></div>
          <div className={styles.playerList}>{snapshot.offlinePlayers.length ? snapshot.offlinePlayers.map((player) => (
            <Link href="/admin/players" key={player.id}><span className={styles.offlineDot} /><span><strong>{player.name}</strong><small>{player.organisation.name} · {player.zone.location.name} / {player.zone.name}</small></span><span><b>{player.status.replaceAll("_", " ")}</b><small>{heartbeatLabel(player.lastHeartbeatAt)}</small></span></Link>
          )) : <p className={styles.empty}>All enrolled players are reporting normally.</p>}</div>
        </section>

        <aside className={styles.quickCard} aria-labelledby="admin-quick-actions-title">
          <p className={styles.eyebrow}>QUICK ACCESS</p><h2 id="admin-quick-actions-title">Daily operations</h2><p>Open the areas most often used to support customers and monitor delivery.</p>
          <div>{quickActions.map((item) => <Link key={item.href} href={item.href}><span>{item.label}</span><b aria-hidden="true">→</b></Link>)}</div>
        </aside>
      </div>
    </div>
  );
}
