"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "@/app/components/EmptyState";
import PageHeader from "@/app/components/PageHeader";
import { safeInterfaceMessage } from "@/lib/interface-guidance.mjs";
import {
  SUBSCRIBER_INSIGHT_RANGES,
  subscriberInsightActions,
  subscriberInsightDates
} from "@/lib/subscriber-insights.mjs";
import styles from "./subscriber-insights.module.css";

const CHART = { width: 820, height: 250, left: 42, right: 790, top: 22, bottom: 205 };

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function number(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

function storageLabel(bytes) {
  return `${(Number(bytes || 0) / (1024 ** 3)).toFixed(2)} GB`;
}

function dayLabel(value, compact = false) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: compact ? "numeric" : "short",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function chartPoints(days, field, maximum) {
  const width = CHART.right - CHART.left;
  const height = CHART.bottom - CHART.top;
  return days.map((day, index) => ({
    ...day,
    x: CHART.left + (index / Math.max(1, days.length - 1)) * width,
    y: CHART.bottom - (Number(day[field] || 0) / Math.max(1, maximum)) * height
  }));
}

function polyline(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function ActivityChart({ days }) {
  const rows = days.map((day) => ({
    ...day,
    exceptions: Number(day.playbackFailedCount || 0) + Number(day.playbackInterruptedCount || 0)
  }));
  const maximum = Math.max(1, ...rows.flatMap((day) => [day.playbackCompletedCount, day.exceptions]));
  const completed = chartPoints(rows, "playbackCompletedCount", maximum);
  const exceptions = chartPoints(rows, "exceptions", maximum);
  const labelEvery = rows.length <= 14 ? 2 : rows.length <= 30 ? 5 : 15;

  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-labelledby="subscriber-chart-title subscriber-chart-description">
      <title id="subscriber-chart-title">Completed playback and playback exceptions by day</title>
      <desc id="subscriber-chart-description">A daily line chart comparing device-confirmed completed playback with failures and interruptions.</desc>
      {[0, .25, .5, .75, 1].map((ratio) => {
        const y = CHART.bottom - ratio * (CHART.bottom - CHART.top);
        return <line key={ratio} x1={CHART.left} x2={CHART.right} y1={y} y2={y} className={styles.gridLine} />;
      })}
      <polyline points={polyline(completed)} className={styles.completedLine} />
      <polyline points={polyline(exceptions)} className={styles.exceptionLine} />
      {completed.map((point, index) => <g key={point.date}>
        <circle cx={point.x} cy={point.y} r="3.5" className={styles.completedPoint}><title>{dayLabel(point.date)}: {number(point.playbackCompletedCount)} completed</title></circle>
        <circle cx={exceptions[index].x} cy={exceptions[index].y} r="3" className={styles.exceptionPoint}><title>{dayLabel(point.date)}: {number(point.exceptions)} exceptions</title></circle>
        {(index % labelEvery === 0 || index === completed.length - 1) ? <text x={point.x} y="232" textAnchor="middle" className={styles.axisLabel}>{dayLabel(point.date, rows.length > 30)}</text> : null}
      </g>)}
    </svg>
  </div>;
}

function Metric({ label, value, detail, tone = "normal" }) {
  return <article className={tone === "warning" ? styles.warningMetric : styles.metric}>
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
  </article>;
}

function ActionCentre({ report }) {
  const actions = subscriberInsightActions(report);
  return <section className={styles.actionCard} aria-labelledby="subscriber-actions-title">
    <div className={styles.sectionHeading}>
      <div><p className={styles.eyebrow}>SERVICE ACTIONS</p><h2 id="subscriber-actions-title">What needs attention</h2></div>
      <span>{actions.length ? `${actions.length} action groups` : "All clear"}</span>
    </div>
    {actions.length ? <div className={styles.actionList}>{actions.map((action) => <article key={action.code} className={styles[action.tone]}>
      <strong className={styles.actionCount}>{action.count}{action.suffix || ""}</strong>
      <div><h3>{action.title}</h3><p>{action.description}</p></div>
      <Link href={action.href}>{action.label}</Link>
    </article>)}</div> : <div className={styles.allClear}><span>✓</span><div><strong>Your service evidence looks healthy</strong><p>No player or playback warnings need attention for this reporting period.</p></div></div>}
  </section>;
}

function ContentMix({ items }) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return <section className={styles.mixCard} aria-labelledby="content-mix-title">
    <div className={styles.cardHeading}><p className={styles.eyebrow}>CONTENT DELIVERY</p><h2 id="content-mix-title">Completed content mix</h2><p>Device-confirmed completed items by content type.</p></div>
    <div className={styles.mixList}>{items.map((item) => <div key={item.id}>
      <span><b>{item.label}</b><strong>{number(item.value)}</strong></span>
      <i><b style={{ width: `${Math.max(2, Math.round((item.value / maximum) * 100))}%` }} /></i>
    </div>)}</div>
  </section>;
}

function BreakdownTabs({ breakdowns }) {
  const [active, setActive] = useState("locations");
  const tabs = [
    { id: "locations", label: "Locations" },
    { id: "players", label: "Players" },
    { id: "stations", label: "Stations" }
  ];
  const rows = breakdowns?.[active] || [];
  const maximum = Math.max(1, ...rows.map((row) => row.completed));

  function detail(row) {
    if (active === "players") return `${row.locationName} · ${row.zoneName}`;
    if (active === "stations") return String(row.status || "Configured").replaceAll("_", " ");
    return `${number(row.exceptions)} exceptions · ${percent(row.confirmationRate)} complete`;
  }

  return <section className={styles.breakdownCard} aria-labelledby="breakdown-title">
    <div className={styles.sectionHeading}>
      <div><p className={styles.eyebrow}>SERVICE BREAKDOWN</p><h2 id="breakdown-title">Where playback is happening</h2></div>
      <Link href="/dashboard/players">Manage players</Link>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Choose service breakdown">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} onClick={() => setActive(tab.id)}>{tab.label}<span>{breakdowns?.[tab.id]?.length || 0}</span></button>)}
    </div>
    {rows.length ? <div className={styles.ranking}>{rows.slice(0, 10).map((row, index) => <article key={row.id}>
      <span className={styles.rank}>{index + 1}</span>
      <div className={styles.rankingName}><strong>{row.name}</strong><small>{detail(row)}</small></div>
      <div className={styles.rankingValue}><strong>{number(row.completed)}</strong><small>completed</small></div>
      <i><b style={{ width: `${Math.max(2, Math.round((row.completed / maximum) * 100))}%` }} /></i>
    </article>)}</div> : <EmptyState compact tone="dark" title={`No ${active} to compare`} description="Playback evidence will appear here after enrolled players confirm activity." />}
  </section>;
}

function SchoolSummary({ school }) {
  if (!school) return null;
  return <section className={styles.schoolCard} aria-labelledby="school-summary-title">
    <div className={styles.cardHeading}><p className={styles.eyebrow}>SCHOOL RADIO</p><h2 id="school-summary-title">Safeguarded aggregate activity</h2><p>No student identities, rankings or individual performance are included.</p></div>
    <dl>
      <div><dt>Programmes</dt><dd>{number(school.programmes)}</dd></div>
      <div><dt>Episodes</dt><dd>{number(school.episodes)}</dd></div>
      <div><dt>Pending reviews</dt><dd>{number(school.pendingReviews)}</dd></div>
      <div><dt>Consent actions</dt><dd>{number(school.consentActions)}</dd></div>
    </dl>
    <Link href="/dashboard/school-radio">Open School Radio</Link>
  </section>;
}

export default function OperationalAnalyticsClient({ organisationName, canExport }) {
  const initial = useMemo(() => subscriberInsightDates(30), []);
  const [filters, setFilters] = useState({ from: initial.from, to: initial.to });
  const [activeRange, setActiveRange] = useState(30);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState({ status: "IDLE", message: "" });

  const loadReport = useCallback(async (nextFilters) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(nextFilters).toString();
      const response = await fetch(`/api/reports/operational?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load service insights.");
      setPayload(body);
    } catch (reportError) {
      setError(safeInterfaceMessage(reportError?.message, "Unable to load service insights."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReport({ from: initial.from, to: initial.to }); }, [initial, loadReport]);

  function selectRange(days) {
    const range = subscriberInsightDates(days);
    const next = { from: range.from, to: range.to };
    setActiveRange(days);
    setFilters(next);
    loadReport(next);
  }

  function applyCustomRange() {
    setActiveRange(null);
    loadReport(filters);
  }

  async function requestExport() {
    setExportState({ status: "QUEUED", message: "Preparing your protected CSV…" });
    try {
      const response = await fetch("/api/reports/operational/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filters)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to prepare the export.");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const statusResponse = await fetch(body.job.statusUrl, { cache: "no-store" });
        const statusBody = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusBody.job?.error || "Unable to check the export.");
        if (statusBody.job.status === "READY") {
          setExportState({ status: "READY", message: `Protected CSV ready (${statusBody.job.rowCount} rows).` });
          window.location.assign(statusBody.job.downloadUrl);
          return;
        }
        if (["FAILED", "EXPIRED"].includes(statusBody.job.status)) throw new Error(statusBody.job.error || "The export could not be completed.");
        setExportState({ status: statusBody.job.status, message: "Preparing your protected CSV…" });
      }
      throw new Error("The export is taking longer than expected. Please try again.");
    } catch (exportError) {
      setExportState({ status: "FAILED", message: safeInterfaceMessage(exportError?.message, "Unable to prepare the protected CSV.") });
    }
  }

  const report = payload?.report;
  const exceptions = report ? report.summary.playbackFailedCount + report.summary.playbackInterruptedCount : 0;

  return <main className={styles.page}>
    <PageHeader eyebrow="Monitor and report" title="Service insights" description={`${organisationName} · understand delivery, player health and content activity without technical reporting language.`} backHref="/dashboard" backLabel="Client dashboard" tone="dark">
      <div className={styles.headerActions}>
        <Link href="/dashboard/reports" className={styles.secondaryButton}>Campaign reports</Link>
        {canExport ? <button type="button" onClick={requestExport} disabled={loading || ["QUEUED", "PROCESSING"].includes(exportState.status)} className={styles.exportButton}>{["QUEUED", "PROCESSING"].includes(exportState.status) ? "Preparing…" : "Download report"}</button> : null}
      </div>
    </PageHeader>

    <section className={styles.controlBar} aria-label="Choose reporting period">
      <div><strong>Reporting period</strong><span>{filters.from} to {filters.to}</span></div>
      <nav aria-label="Reporting period shortcuts">{SUBSCRIBER_INSIGHT_RANGES.map((days) => <button key={days} type="button" onClick={() => selectRange(days)} aria-pressed={activeRange === days}>{days} days</button>)}</nav>
      <details>
        <summary>Custom dates</summary>
        <div>
          <label>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <button type="button" onClick={applyCustomRange} disabled={loading}>Apply</button>
        </div>
      </details>
    </section>

    <p className={styles.evidenceNotice}><strong>Evidence boundary:</strong> {report?.evidenceNotice || "Operational totals are not audience measurements."}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {exportState.message ? <p role="status" className={exportState.status === "FAILED" ? styles.error : styles.status}>{exportState.message}</p> : null}
    {report?.aggregation?.pending ? <p role="status" className={styles.status}>Earlier evidence is still being prepared. Refresh the report shortly to complete the history.</p> : null}

    {loading && !report ? <section className={styles.loading} aria-label="Loading service insights"><span /><span /><span /><span /></section> : null}

    {report ? <>
      <section className={styles.metrics} aria-label="Service summary">
        <Metric label="Completed playback" value={number(report.summary.playbackCompletedCount)} detail="Device confirmed" />
        <Metric label="Completion rate" value={percent(report.summary.confirmationRate)} detail={`${number(report.summary.playbackStartedCount)} items started`} tone={report.summary.confirmationRate < .95 && report.summary.playbackStartedCount ? "warning" : "normal"} />
        <Metric label="Players online" value={`${report.players.onlineNow} / ${report.players.enrolled}`} detail={report.players.offlineNow ? `${report.players.offlineNow} need attention` : "All enrolled players reporting"} tone={report.players.offlineNow ? "warning" : "normal"} />
        <Metric label="Playback exceptions" value={number(exceptions)} detail="Failed or interrupted" tone={exceptions ? "warning" : "normal"} />
        <Metric label="Protected audio" value={storageLabel(report.storage.bytes)} detail={`${number(report.storage.assetCount)} media records`} />
      </section>

      <div className={styles.primaryGrid}>
        <section className={styles.chartCard} aria-labelledby="activity-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>DELIVERY TREND</p><h2 id="activity-title">Daily playback confidence</h2><p>Completed playback compared with failures and interruptions.</p></div>
            <div className={styles.legend}><span><i className={styles.completedLegend} />Completed</span><span><i className={styles.exceptionLegend} />Exceptions</span></div>
          </div>
          {report.days.length ? <ActivityChart days={report.days} /> : <EmptyState compact tone="dark" title="No playback evidence yet" description="Evidence will appear after an enrolled player completes playback." />}
        </section>
        <ContentMix items={report.contentMix} />
      </div>

      <ActionCentre report={report} />
      <BreakdownTabs breakdowns={report.breakdowns} />

      <div className={styles.secondaryGrid}>
        <section className={styles.operationsCard} aria-labelledby="operations-title">
          <div className={styles.cardHeading}><p className={styles.eyebrow}>SERVICE FOOTPRINT</p><h2 id="operations-title">Content and operations</h2></div>
          <dl>
            <div><dt>Campaigns</dt><dd>{number(report.content.campaigns)}</dd></div>
            <div><dt>Promotions</dt><dd>{number(report.content.promotions)}</dd></div>
            <div><dt>Studio orders</dt><dd>{number(report.content.productionOrders)}</dd></div>
            <div><dt>Heartbeat coverage</dt><dd>{percent(report.players.observedHeartbeatCoverage)}</dd></div>
          </dl>
          <div className={styles.reportLinks}><Link href="/dashboard/reports">Campaign delivery →</Link><Link href="/dashboard/player-sessions">Live sessions →</Link></div>
        </section>
        <SchoolSummary school={report.school} />
      </div>

      <details className={styles.dailyCard} id="daily-evidence">
        <summary><span><b>Daily operational evidence</b><small>{report.days.length} reporting days · UTC</small></span><strong>View details</strong></summary>
        <div className={styles.tableWrap}><table>
          <thead><tr>{["UTC day", "Planned", "Started", "Completed", "Failed", "Interrupted", "Heartbeat samples"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{report.days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{number(day.plannedCount)}</td><td>{number(day.playbackStartedCount)}</td><td>{number(day.playbackCompletedCount)}</td><td>{number(day.playbackFailedCount)}</td><td>{number(day.playbackInterruptedCount)}</td><td>{number(day.heartbeatCount)}</td></tr>)}</tbody>
        </table></div>
      </details>
      <p className={styles.retention}>{report.retentionNotice}</p>
    </> : null}
  </main>;
}
