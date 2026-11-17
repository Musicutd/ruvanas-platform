"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { safeReportingResult } from "@/lib/retail-rewards/reporting-dtos.mjs";
import { reversalReasonLabel } from "@/lib/retail-rewards/reversal-ui.mjs";
import styles from "./reports.module.css";

const BASE = "/api/retail-rewards/reports", CUTOFF_MS = 15 * 60 * 1000;
const CSV_FILENAMES = { CLAIMS: "ruvanas-rewards-claims.csv", REDEMPTIONS: "ruvanas-rewards-receipts.csv" };
function messageFor(code) {
  return ({ REPORT_TOO_LARGE: "There is too much activity in this period. Choose a shorter date range and try again.",
    REPORT_EXPIRED: "This report’s cutoff has expired. Refresh the report before changing pages or downloading it.",
    INVALID_REQUEST: "Check the shop and dates. Choose a period within the available reporting dates.",
    UNAUTHENTICATED: "Your access could not be confirmed. Please sign in again.",
    FORBIDDEN: "You do not have permission to view or export this report.",
    NOT_ENTITLED: "Reports are not currently included in this account’s Rewards access.",
    LOCATION_UNAVAILABLE: "This shop is not available for your reporting access. Choose an authorised shop.",
    FEATURE_DISABLED: "Rewards reports are not available right now.",
    RATE_LIMITED: "Too many requests. Please wait a moment before trying again."
  })[code] || "We couldn’t load this report. Please try again.";
}
function calendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
function dateTime(value, timezone) {
  try { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value)); }
  catch { return "Time unavailable"; }
}
function validReport(result, query) {
  const safe = safeReportingResult("report", result);
  return !!safe && safe.location.id === query.locationId && safe.filters.fromDate === query.fromDate &&
    safe.filters.toDate === query.toDate && safe.page === query.page && safe.view === query.view &&
    (!query.asOf || safe.asOf === query.asOf);
}
function CampaignAssociation({ association }) {
  return association ? <><strong>{association.campaignName}</strong><small>{association.promoName}</small><small>Campaign version {association.campaignRevision}</small></> : <span className={styles.unlinked}>No campaign linked</span>;
}

export default function ReportsClient({ initialData, transport = checkoutTransport, exportTransport = checkoutTransport, previewOnly = false }) {
  const [setup, setSetup] = useState({ locations: [], page: 1, hasMore: false, defaults: {}, bounds: { maxRangeDays: 31 }, timezone: "Europe/Malta", ...initialData });
  const [locationId, setLocationId] = useState(""), [fromDate, setFromDate] = useState(initialData?.defaults?.fromDate || ""), [toDate, setToDate] = useState(initialData?.defaults?.toDate || "");
  const [view, setView] = useState("REDEMPTIONS");
  const [report, setReport] = useState(null), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [now, setNow] = useState(Date.now());
  const [error, setError] = useState(initialData?.ok === false ? messageFor(initialData.code) : ""), [notice, setNotice] = useState("");
  const alive = useRef(true), sequence = useRef(0), active = useRef(null), exportActive = useRef(null), pendingExport = useRef(false), urls = useRef(new Map());
  const outputRef = useRef(null), errorRef = useRef(null);
  function releaseDownloads() { for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url); } urls.current.clear(); }
  function invalidate() {
    sequence.current++; active.current?.abort(); exportActive.current?.abort(); pendingExport.current = false;
    releaseDownloads(); setReport(null); setBusy(false); setExporting(false); setError(""); setNotice("");
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; active.current?.abort(); exportActive.current?.abort(); releaseDownloads(); }; }, []);
  useEffect(() => { if (report) outputRef.current?.focus(); }, [report]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!report) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [report]);
  const stale = Boolean(report && Date.parse(report.asOf) + CUTOFF_MS <= now);
  function checkFilters() {
    const start = calendarDay(fromDate), end = calendarDay(toDate);
    if (!locationId || start === null || end === null || end < start ||
      (end - start) / 86400000 + 1 > Math.min(setup.bounds?.maxRangeDays || 31, 31) ||
      (setup.bounds?.earliestDate && fromDate < setup.bounds.earliestDate) || (setup.bounds?.latestDate && toDate > setup.bounds.latestDate)) {
      setError("Choose an authorised shop and valid dates, up to 31 days within the available reporting period."); return false;
    }
    return true;
  }
  async function loadLocations(page) {
    invalidate(); setLocationId(""); const request = ++sequence.current, controller = new AbortController(); active.current = controller; setBusy(true);
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await checkoutRequest(transport, `${BASE}/locations?page=${page}`, { signal: controller.signal });
      if (alive.current && request === sequence.current) setSetup(result);
    } catch (problem) { if (alive.current && request === sequence.current) setError(messageFor(problem.code)); }
    finally { clearTimeout(timer); if (alive.current && request === sequence.current) { setBusy(false); active.current = null; } }
  }
  async function loadReport(page = 1, keepCutoff = false) {
    if (!checkFilters()) return;
    const query = { locationId, fromDate, toDate, view, page, ...(keepCutoff && report ? { asOf: report.asOf } : {}) };
    invalidate(); const request = ++sequence.current, controller = new AbortController(); active.current = controller; setBusy(true);
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await checkoutRequest(transport, `${BASE}/query`, { method: "POST", body: query, signal: controller.signal });
      if (!alive.current || request !== sequence.current) return;
      if (!validReport(result, query)) throw new Error("Invalid report response");
      setReport(result); setNow(Date.now());
    } catch (problem) { if (alive.current && request === sequence.current) setError(messageFor(problem.code)); }
    finally { clearTimeout(timer); if (alive.current && request === sequence.current) { setBusy(false); active.current = null; } }
  }
  async function downloadCsv() {
    if (!report?.exportAllowed || pendingExport.current || busy || stale) return;
    const current = report, request = sequence.current, controller = new AbortController();
    const body = { locationId: current.location.id, fromDate: current.filters.fromDate, toDate: current.filters.toDate, view: current.view, asOf: current.asOf };
    pendingExport.current = true; exportActive.current = controller; setExporting(true); setError(""); setNotice("");
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await exportTransport(`${BASE}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response?.ok) { const denied = typeof response?.json === "function" ? await response.json() : response; const problem = new Error("Export unavailable"); problem.code = denied?.code; throw problem; }
      if (!/^text\/csv(?:\s*;|$)/i.test(response.headers?.get("content-type") || "") || typeof response.blob !== "function") throw new Error("Invalid export response");
      const blob = await response.blob();
      if (!alive.current || request !== sequence.current || controller.signal.aborted || Date.parse(current.asOf) + CUTOFF_MS <= Date.now()) return;
      if (blob.size === 0 || blob.size > 2 * 1024 * 1024) throw new Error("Invalid export size");
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = CSV_FILENAMES[current.view]; link.hidden = true; document.body.appendChild(link); link.click(); link.remove();
      const release = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000); urls.current.set(url, release);
      setNotice(`${current.view === "CLAIMS" ? "Coupon claims" : "Redemptions"} CSV download requested for this shop and date range. It contains coupon activity and saved campaign associations, not customer details or payments.`);
    } catch (problem) { if (alive.current && request === sequence.current) setError(messageFor(problem.code)); }
    finally { clearTimeout(timer); if (alive.current && request === sequence.current) { pendingExport.current = false; exportActive.current = null; setExporting(false); } }
  }
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL REPORTS PREVIEW</strong> · Synthetic coupon activity · No live accounts or exports</p>}
    <div className={styles.container}><a className={styles.back} href="/dashboard/retail/rewards">← Shop offers</a><p className={styles.eyebrow}>RUVANAS REWARDS · CLIENT ADMIN</p><h1>See your coupon activity.</h1><p className={styles.lead}>Review coupon claims, redemptions and the promotion saved with each issued coupon.</p>
      <section className={styles.filterCard} aria-label="Report filters"><form onSubmit={event => { event.preventDefault(); loadReport(); }} noValidate>
        <fieldset className={styles.viewPicker}><legend>Activity to show</legend>{[["REDEMPTIONS", "Redemptions"], ["CLAIMS", "Coupon claims"]].map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} className={view === value ? styles.selectedView : styles.viewButton} onClick={() => { if (value !== view) { invalidate(); setView(value); } }}>{label}</button>)}</fieldset>
        <div className={styles.filters}><label className={styles.field}>Your shop<select value={locationId} onChange={event => { invalidate(); setLocationId(event.target.value); }}><option value="">Choose an authorised shop</option>{setup.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label className={styles.field}>From<input type="date" value={fromDate} min={setup.bounds?.earliestDate} max={setup.bounds?.latestDate} onChange={event => { invalidate(); setFromDate(event.target.value); }} /></label>
          <label className={styles.field}>To<input type="date" value={toDate} min={setup.bounds?.earliestDate} max={setup.bounds?.latestDate} onChange={event => { invalidate(); setToDate(event.target.value); }} /></label>
          <button type="submit" className={styles.primary} disabled={busy || !setup.locations.length}>{busy ? "Loading report…" : "Show report"}</button></div>
        <p className={styles.help}>Both selected dates are included, using <strong>{setup.timezone}</strong>. Choose up to 31 days{setup.bounds?.earliestDate && setup.bounds?.latestDate ? ` between ${setup.bounds.earliestDate} and ${setup.bounds.latestDate}` : ""}.</p>
        {(setup.hasMore || setup.page > 1) && <div className={styles.pagination}><button type="button" className={styles.textButton} disabled={busy || setup.page <= 1} onClick={() => loadLocations(setup.page - 1)}>← Previous shops</button><span>Shop page {setup.page}</span><button type="button" className={styles.textButton} disabled={busy || !setup.hasMore} onClick={() => loadLocations(setup.page + 1)}>More shops →</button></div>}
      </form></section>
      {error && <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      {busy && <p className={styles.loading} role="status">Checking current shop permissions and activity…</p>}
      {!busy && !error && !report && <div className={styles.empty}><h2>{setup.locations.length ? "Start with one shop." : "No authorised shops on this page."}</h2><p>{setup.locations.length ? "Apply your filters to see a report. Viewing activity does not change offers or redemptions." : setup.hasMore ? "Continue to the next shop page to check the remaining locations." : "Your Client Admin manages reporting access. No customer profiles are shown here."}</p></div>}
      {report && <section className={styles.report} aria-label="Coupon activity report" tabIndex={-1} ref={outputRef}>
        <div className={styles.reportHeading}><div><p className={styles.eyebrow}>YOUR SELECTED SHOP</p><h2>{report.location.name}</h2><p>{report.filters.fromDate} – {report.filters.toDate} · {report.filters.timezone}</p></div><div className={styles.reportActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => loadReport()}>Refresh report</button><button type="button" className={styles.primary} disabled={exporting || busy || stale || !report.exportAllowed} onClick={downloadCsv}>{exporting ? "Preparing CSV…" : "Download CSV"}</button></div></div>
        {!report.exportAllowed && <p className={styles.help}>CSV export is not available for your current access to this shop.</p>}
        {stale && <p className={styles.notice} role="status">This report’s cutoff has expired. Refresh it before changing pages or downloading CSV.</p>}
        <div className={styles.metrics} aria-label="Report totals"><article><h3>Coupons issued</h3><strong>{report.summary.issued.toLocaleString("en-GB")}</strong><p>Issued during this period</p></article><article><h3>Successful uses</h3><strong>{report.summary.successfulUses.toLocaleString("en-GB")}</strong><p>Redemptions recorded in this period</p></article><article><h3>Corrected uses</h3><strong>{report.summary.correctedUses.toLocaleString("en-GB")}</strong><p>Of those uses, corrected by the cutoff</p></article><article className={styles.net}><h3>Net uses</h3><strong>{report.summary.netUses.toLocaleString("en-GB")}</strong><p>Successful uses minus corrected uses</p></article></div>
        <details className={styles.definitions}><summary>What these numbers mean</summary><p>Coupons issued and successful uses are separate counts. A coupon issued earlier may be redeemed in this period. These numbers do not measure unique shoppers, visits or conversion.</p><p>Corrected uses are corrections attached to the redemptions in this report, recorded by its cutoff. A correction does not restore the shop’s monthly service allowance: that allowance counts every successful use.</p><p>These are coupon records, not verified sales, revenue, payments or refunds. No customer profiles or payment details are included.</p></details>
        <div className={styles.receiptHeading}><h2>{report.view === "CLAIMS" ? "Coupon claims" : "Redemption receipts"}</h2><p>{(report.view === "CLAIMS" ? report.claims : report.receipts).length} shown · {report.totalRows.toLocaleString("en-GB")} in this report</p></div>
        <p className={styles.associationHelp}>A campaign association is saved with the issued coupon version. Later campaign edits do not change it. It does not confirm that an advert played or caused a purchase.</p>
        {(report.view === "CLAIMS" ? report.claims : report.receipts).length ? <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>{report.view === "CLAIMS" ? "Coupon claims" : "Redemption receipts"} for {report.location.name} in the selected period</caption><thead><tr><th scope="col">{report.view === "CLAIMS" ? "Issued" : "Recorded"}</th><th scope="col">Offer &amp; shop</th><th scope="col">Saved campaign</th><th scope="col">{report.view === "CLAIMS" ? "Claim ID" : "Confirmation ID"}</th>{report.view === "REDEMPTIONS" && <th scope="col">Status</th>}</tr></thead><tbody>{(report.view === "CLAIMS" ? report.claims : report.receipts).map(row => <tr key={row.id}>
          <td data-label={report.view === "CLAIMS" ? "Issued" : "Recorded"}><time dateTime={report.view === "CLAIMS" ? row.issuedAt : row.redeemedAt}>{dateTime(report.view === "CLAIMS" ? row.issuedAt : row.redeemedAt, report.filters.timezone)}</time><small>{report.filters.timezone}</small></td>
          <td data-label="Offer & shop"><strong>{row.offerTitle}</strong><small>Issued version {row.revision} · {row.shopName}</small></td>
          <td data-label="Saved campaign"><CampaignAssociation association={row.campaignAssociation} /></td>
          <td data-label={report.view === "CLAIMS" ? "Claim ID" : "Confirmation ID"} className={styles.receiptId}>{row.id}</td>
          {report.view === "REDEMPTIONS" && <td data-label="Status"><span className={`${styles.badge} ${row.status === "CORRECTED" ? styles.corrected : ""}`}>{row.status === "CORRECTED" ? "Corrected" : "Redeemed"}</span>{row.correction && <><small>{reversalReasonLabel(row.correction.reason)}</small><small>{dateTime(row.correction.reversedAt, report.filters.timezone)}</small></>}</td>}
        </tr>)}</tbody></table></div> : <p className={styles.empty}>No {report.view === "CLAIMS" ? "coupon claims" : "redemption receipts"} on this page{report.hasMore ? ". Continue to the next page to check the remaining records." : " for the selected period."}</p>}
        <div className={styles.receiptPagination}><button type="button" className={styles.secondary} disabled={busy || stale || report.page <= 1} onClick={() => loadReport(report.page - 1, true)}>← Previous page</button><span>Page {report.page}</span><button type="button" className={styles.secondary} disabled={busy || stale || !report.hasMore} onClick={() => loadReport(report.page + 1, true)}>Next page →</button></div>
        <p className={styles.cutoff}>Activity cutoff: {dateTime(report.asOf, report.filters.timezone)}. Access checked: {dateTime(report.checkedAt, report.filters.timezone)} ({report.filters.timezone}).</p><p className={styles.help}>Pages and CSV use this cutoff for up to 15 minutes. Permissions are checked again each time. This is not a saved snapshot: late-recorded activity can change results. Refresh to get a new cutoff.</p>
      </section>}
    </div>
  </main>;
}
