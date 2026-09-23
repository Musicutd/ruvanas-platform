"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./retail-control-centre.module.css";

const STATUS = {
  HEALTHY: { label: "Playback confirmed", tone: "good" },
  ATTENTION: { label: "Needs attention", tone: "warn" },
  OFFLINE: { label: "Player offline", tone: "bad" },
  SETUP: { label: "Setup needed", tone: "neutral" },
  CLOSED: { label: "Closed now", tone: "neutral" }
};

function Status({ state }) {
  const status = STATUS[state] || STATUS.SETUP;
  return <span className={`${styles.status} ${styles[status.tone]}`}><span className={styles.statusDot} aria-hidden="true" />{status.label}</span>;
}

function heroCopy(summary) {
  if (!summary.counts.stores) return { title: "Let's get your first shop ready", detail: "Start with a location and listening area. Your music and player steps will appear here as the setup progresses." };
  if (summary.overallState === "SETUP") return { title: "Finish your shop setup", detail: "A listening area, approved music or a connected player still needs attention before playback can be confirmed." };
  if (summary.overallState === "ATTENTION") return { title: `${summary.counts.attentionStores} ${summary.counts.attentionStores === 1 ? "shop needs" : "shops need"} a check`, detail: "See what needs attention below. Music settings and published programmes have not been changed." };
  if (summary.overallState === "CLOSED") return { title: "Your shops are closed right now", detail: "The next scheduled music is shown below. Playback confirmation resumes when players report again." };
  return { title: "Your retail sound at a glance", detail: "See confirmed playback, today’s planned music and the shops that need a hand." };
}

function SummaryCard({ label, value, note, tone }) {
  return <div className={`${styles.summaryCard} ${tone === "accent" ? styles.summaryAccent : ""}`}>
    <span>{label}</span><strong>{value}</strong><small>{note}</small>
  </div>;
}

function StoreCard({ store, signageEnabled }) {
  const soundNames = [...new Set(store.zones.map((zone) => zone.selectedSound).filter(Boolean))];
  const sound = soundNames.length === 1 ? soundNames[0] : soundNames.length > 1 ? "Different sounds by area" : "No music selected";
  const confirmed = store.zones.find((zone) => zone.recentPlayback);
  return <article className={styles.storeCard}>
    <div className={styles.storeTop}>
      <div><h3>{store.name}</h3><p>{store.city || "Retail location"} · {store.zones.length} {store.zones.length === 1 ? "area" : "areas"}</p></div>
      <Status state={store.state} />
    </div>
    <div className={styles.storeDetails}>
      <div><span>Selected sound</span><strong>{sound}</strong></div>
      <div><span>Players</span><strong>{store.readyPlayerCount} of {store.playerCount} playback confirmed</strong></div>
      <div><span>Opening hours</span><strong>{store.openingState === "UNKNOWN" ? "Not set" : store.openingState === "OPEN" ? "Open now" : "Closed now"}</strong></div>
      <div><span>Promotions</span><strong>{store.promotionCount} in today’s date window</strong></div>
      {signageEnabled ? <div><span>Displays</span><strong>{store.onlineScreenCount} of {store.screenCount} connected</strong></div> : null}
    </div>
    {confirmed ? <p className={styles.evidence}>Recent audio confirmed in {confirmed.name}: {confirmed.recentPlayback.artist ? `${confirmed.recentPlayback.artist} — ` : ""}{confirmed.recentPlayback.title || "Audio item"}. This is not a live now-playing claim.</p> : <p className={styles.evidence}>No recent playback confirmation. Check the player before assuming listeners can hear audio.</p>}
    {store.zones.length > 1 ? <div className={styles.zones} aria-label={`${store.name} areas`}>{store.zones.map((zone) => <span key={zone.id}>{zone.name}: {STATUS[zone.state]?.label || "Setup needed"}</span>)}</div> : null}
    <div className={styles.storeActions}>
      <Link href="/dashboard/players">Check players</Link>
      <Link href="/dashboard/retail/music">{store.zones.length ? "View shop music" : "Set up music"}</Link>
    </div>
  </article>;
}

export default function RetailControlCentre({ summary, onboarding, complimentary }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const filteredStores = useMemo(() => summary.stores.filter((store) => {
    const matchesQuery = `${store.name} ${store.city || ""}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === "ALL" || filter === "ATTENTION" && ["ATTENTION", "OFFLINE", "SETUP"].includes(store.state) || store.state === filter);
  }), [summary.stores, query, filter]);
  const copy = heroCopy(summary);
  const next = onboarding.nextAction;
  const firstTimeline = summary.timeline[0];
  const hasEvidence = summary.counts.readyPlayers > 0;

  return <main id="main-content" className={styles.page}>
    <div className={styles.container}>
      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>RETAIL CONTROL CENTRE</p>
          <h1>{copy.title}</h1>
          <p>{copy.detail}</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href={next.href}>{next.label}</Link>
            <Link className={styles.secondaryAction} href="/dashboard/retail/music">{summary.canManage ? "Change shop music" : "View shop music"}</Link>
          </div>
        </div>
        <div className={styles.heroPulse}>
          <Status state={summary.overallState} />
          <strong>{summary.counts.healthyStores} of {summary.counts.stores}</strong>
          <span>shops with playback confirmed</span>
          <small>Checked {summary.checkedAt.slice(11, 16)} UTC · Recent player evidence, not a live audio meter</small>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Today at a glance">
        <SummaryCard label="Recent audio" value={summary.recentPlayback ? `${summary.recentPlayback.artist ? `${summary.recentPlayback.artist} — ` : ""}${summary.recentPlayback.title || "Audio item"}` : "Not confirmed"} note={summary.recentPlayback ? `Last reported by ${summary.recentPlayback.storeName} · within 15 minutes` : "Open a shop player to verify sound"} tone="accent" />
        <SummaryCard label="Next planned music" value={firstTimeline ? `${firstTimeline.time} · ${firstTimeline.label}` : "No later slot today"} note={firstTimeline ? `${firstTimeline.storeName} · local shop time` : "Published schedules stay in place"} />
        <SummaryCard label="Promotion date windows" value={String(summary.counts.promotionsToday)} note="Published and dated for at least one shop today; check each campaign’s play times" />
        <SummaryCard label="Needs a check" value={String(summary.counts.attentionStores)} note={summary.counts.attentionStores ? "Open the attention list below" : "No open shop checks in this view"} />
      </section>

      <div className={styles.mainGrid}>
        <div className={styles.mainColumn}>
          <section className={styles.panel} aria-labelledby="shops-title">
            <div className={styles.sectionHead}><div><p className={styles.eyebrow}>YOUR SHOPS</p><h2 id="shops-title">Locations at a glance</h2><p>{summary.counts.activeStores} active shops · {summary.counts.zones} listening areas · {summary.counts.players} players{summary.limited ? " · Showing a limited overview; open Locations for the full list" : ""}</p></div><Link href="/dashboard/locations">Locations & areas</Link></div>
            {summary.stores.length ? <>
              <div className={styles.filters}>
                <label className={styles.searchLabel}>Find a shop<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or city" /></label>
                <div className={styles.filterButtons} role="group" aria-label="Filter shops">{[["ALL", "All"], ["HEALTHY", "Confirmed"], ["ATTENTION", "Needs a check"], ["CLOSED", "Closed"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? styles.activeFilter : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
              </div>
              <div className={styles.storeList}>{filteredStores.length ? filteredStores.map((store) => <StoreCard key={store.id} store={store} signageEnabled={summary.entitlements.digitalSignageEnabled} />) : <p className={styles.empty}>No shops match this search. Try another name or filter.</p>}</div>
            </> : <div className={styles.emptyState}><h3>No retail locations yet</h3><p>Once Ruvanas prepares your first shop and listening area, its status will appear here.</p><Link href="/dashboard/locations">Review locations</Link></div>}
          </section>

          <section className={styles.panel} aria-labelledby="timeline-title"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>COMING UP TODAY</p><h2 id="timeline-title">Planned music</h2><p>Published schedule slots, shown in each shop’s local time. These are plans, not playback proof.</p></div><Link href="/dashboard/programming">Open schedule</Link></div>
            {summary.timeline.length ? <ol className={styles.timeline}>{summary.timeline.map((event) => <li key={event.id}><time>{event.time}</time><div><strong>{event.label}</strong><span>{event.storeName} · {event.timezone}</span></div></li>)}</ol> : <p className={styles.empty}>No later published music slot appears today. Continuous music may still be configured for a shop.</p>}
          </section>
        </div>

        <aside className={styles.sideColumn} aria-label="Retail guidance and insights">
          <section className={styles.nextCard}><p className={styles.eyebrow}>YOUR NEXT STEP</p><h2>{next.title}</h2><p>{next.description}</p><Link href={next.href}>{next.label} →</Link><small>{onboarding.completedCount} of {onboarding.totalCount} setup steps complete{complimentary ? " · Complimentary service" : ""}</small></section>
          <section className={styles.panel} aria-labelledby="attention-title"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>ATTENTION</p><h2 id="attention-title">What needs a check</h2></div></div>{summary.attention.length ? <ul className={styles.attentionList}>{summary.attention.map((item) => <li key={item.id}><strong>{item.name}</strong><span>{item.message}</span><Link href={item.href}>Review →</Link></li>)}</ul> : <p className={styles.empty}>{summary.stores.length ? "No shop checks are flagged in this overview." : "Your first shop’s checks will appear here after setup."}</p>}</section>
          <section className={styles.panel} aria-labelledby="insights-title"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>INSIGHT PREVIEW</p><h2 id="insights-title">Delivery confidence</h2></div></div><p className={styles.insightNumber}>{summary.counts.readyPlayers}<span> / {summary.counts.players} players</span></p><p>{hasEvidence ? "Recent playback evidence was received from these players." : "No recent player has confirmed audio in this view."} This does not measure listener impressions.</p><div className={styles.linkRow}><Link href="/dashboard/analytics">Service insights</Link><Link href="/dashboard/reports">Delivery reports</Link></div></section>
        </aside>
      </div>

      <section className={styles.bottomPanel} aria-labelledby="tools-title"><div><p className={styles.eyebrow}>MORE WHEN YOU NEED IT</p><h2 id="tools-title">Your retail tools</h2><p>The full tools are still here; start with the everyday actions above.</p></div><div className={styles.toolLinks}><Link href="/dashboard/promotions">{summary.canManage ? "Create a promotion" : "View promotions"}</Link><Link href="/dashboard/studio">Open Studio</Link><Link href="/dashboard/players">Shop players</Link>{summary.entitlements.digitalSignageEnabled ? <Link href="/dashboard/digital-signage">Digital signage</Link> : null}{summary.entitlements.retailMediaEnabled ? <Link href="/dashboard/retail-media">Retail media</Link> : null}</div></section>
      <details className={styles.setupDetails}><summary>See all setup steps</summary><ol>{onboarding.steps.map((step) => <li key={step.id}><span>{step.complete ? "Done" : step.status === "CURRENT" ? "Next" : "Later"}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div><Link href={step.href}>{step.actionLabel}</Link></li>)}</ol></details>
    </div>
  </main>;
}
