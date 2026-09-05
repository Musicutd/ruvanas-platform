"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./listener-analytics.module.css";

const ranges = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" }
];

const number = (value) => new Intl.NumberFormat("en-GB").format(Number(value) || 0);
const decimal = (value, digits = 1) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);

function Metric({ label, value, detail, tone = "normal" }) {
  return <article className={tone === "warning" ? styles.metricWarning : styles.metric}>
    <span>{label}</span><strong>{value}</strong><small>{detail}</small>
  </article>;
}

function DailyChart({ days }) {
  const maximum = Math.max(1, ...days.map((day) => day.listenerHours));
  return <div className={styles.chart} aria-label="Daily listener hours chart">
    {days.map((day) => {
      const height = Math.max(day.listenerHours ? 5 : 0, Math.round((day.listenerHours / maximum) * 100));
      return <div className={styles.barColumn} key={day.date} title={`${day.date}: ${decimal(day.listenerHours, 2)} listener hours`}>
        <div className={styles.barTrack}><span style={{ height: `${height}%` }} /></div>
        <small>{day.date.slice(5)}</small>
      </div>;
    })}
  </div>;
}

export default function ListenerAnalyticsClient({ organisationName, canExport }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setReport(null);
    fetch(`/api/listener-analytics?days=${days}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load listener analytics.");
        if (active) setReport(payload);
      })
      .catch((loadError) => { if (active && loadError.name !== "AbortError") setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [days]);

  const chartDays = useMemo(() => {
    if (!report?.days) return [];
    if (report.days.length <= 31) return report.days;
    return report.days.filter((_, index) => index % 3 === 0 || index === report.days.length - 1);
  }, [report]);

  return <main className={styles.page} id="main-content">
    <header className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>ONLINE RADIO · AUDIENCE</p>
        <h1>Listener analytics</h1>
        <p>Understand how anonymous listening sessions engage with {organisationName}&apos;s channels—without collecting personal identity.</p>
      </div>
      <div className={styles.controls} aria-label="Listener analytics period">
        {ranges.map((range) => <button type="button" key={range.value} className={days === range.value ? styles.activeRange : styles.range} onClick={() => setDays(range.value)}>{range.label}</button>)}
        {canExport && report ? <a className={styles.export} href={`/api/listener-analytics/export?days=${days}`}>Export CSV</a> : null}
      </div>
    </header>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {loading ? <div className={styles.loading} role="status">Preparing privacy-safe listener totals…</div> : null}

    {report ? <>
      <section className={styles.metrics} aria-label="Listener summary">
        <Metric label="Session starts" value={number(report.totals.sessionStarts)} detail={`${report.filters.from} to ${report.filters.to}`} />
        <Metric label="Listener hours" value={decimal(report.totals.listenerHours)} detail="Confirmed listening time" />
        <Metric label="Average listening" value={`${decimal(report.totals.averageListeningMinutes)} min`} detail="Per session start" />
        <Metric label="Peak hourly audience" value={number(report.totals.peakHourlyListeners)} detail="Anonymous sessions in one UTC hour" />
        <Metric label="Playback errors" value={number(report.totals.playbackErrors)} detail="Client-reported interruptions" tone={report.totals.playbackErrors ? "warning" : "normal"} />
      </section>

      <section className={styles.chartCard} aria-labelledby="listener-trend-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>AUDIENCE TREND</p><h2 id="listener-trend-title">Daily listener hours</h2><p>Confirmed time from short, duplicate-safe listener heartbeats.</p></div>
          <span>UTC reporting</span>
        </div>
        {report.totals.listenerHours > 0 ? <DailyChart days={chartDays} /> : <div className={styles.empty}><strong>No public listener evidence yet</strong><p>The analytics foundation is ready. Audience activity will appear when the public player begins issuing protected session telemetry.</p></div>}
      </section>

      <section className={styles.channelCard} aria-labelledby="channel-performance-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CHANNEL VIEW</p><h2 id="channel-performance-title">Audience by channel</h2><p>Compare engagement without exposing individual listeners.</p></div></div>
        {report.channels.length ? <div className={styles.tableWrap}><table>
          <thead><tr><th>Channel</th><th>Session starts</th><th>Listener hours</th><th>Peak hour</th><th>Errors</th></tr></thead>
          <tbody>{report.channels.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{number(channel.sessionStarts)}</td><td>{decimal(channel.listenerHours, 2)}</td><td>{number(channel.peakHourlyListeners)}</td><td>{number(channel.playbackErrors)}</td></tr>)}</tbody>
        </table></div> : <p className={styles.noChannels}>No channel audience totals are available for this period.</p>}
      </section>

      <section className={styles.privacy} aria-labelledby="privacy-title">
        <div><p className={styles.eyebrow}>PRIVACY BY DESIGN</p><h2 id="privacy-title">Useful totals, minimal data</h2><p>{report.privacy.notice}</p></div>
        <dl>
          <div><dt>Personal identity</dt><dd>Not collected</dd></div>
          <div><dt>Raw IP addresses</dt><dd>Not stored</dd></div>
          <div><dt>Raw event retention</dt><dd>{report.privacy.rawRetentionDays} days</dd></div>
          <div><dt>Anonymous aggregates</dt><dd>{report.privacy.aggregateRetentionDays} days</dd></div>
        </dl>
      </section>

      <footer className={styles.footer}>
        <div><strong>What comes next?</strong><span>The public player will use this protected analytics contract without changing the privacy boundary.</span></div>
        <Link href="/dashboard/radio">Back to Online Radio</Link>
      </footer>
    </> : null}
  </main>;
}
