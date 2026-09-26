"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./retail-control-centre.module.css";

const STATUS = {
  HEALTHY: { label: "Player ready", tone: "good" },
  ATTENTION: { label: "Needs a check", tone: "warn" },
  OFFLINE: { label: "Player offline", tone: "bad" },
  SETUP: { label: "Setup needed", tone: "neutral" },
  CLOSED: { label: "Closed now", tone: "neutral" }
};

function Status({ state }) {
  const status = STATUS[state] || STATUS.SETUP;
  return <span className={`${styles.status} ${styles[status.tone]}`}><span className={styles.statusDot} aria-hidden="true" />{status.label}</span>;
}

function heroCopy(summary) {
  if (!summary.counts.stores) return { title: "Let's get your first shop ready", detail: "Follow the next step below. Your shop will appear here once it has been prepared." };
  if (summary.overallState === "SETUP") return { title: "Let's finish setting up your shops", detail: "Choose music and check your shop player so customers can hear it." };
  if (summary.overallState === "ATTENTION") return { title: "A shop needs your attention", detail: "See which shop needs a check below. Your music settings have not changed." };
  if (summary.overallState === "CLOSED") return { title: "Your shops are closed now", detail: "You can still prepare tomorrow's music and promotions." };
  return { title: "Your shops at a glance", detail: "Check your shops, change the music or plan a promotion." };
}

function storeSound(store) {
  const names = [...new Set(store.zones.map((zone) => zone.selectedSound).filter(Boolean))];
  return names.length === 1 ? names[0] : names.length > 1 ? "Different music by area" : "No music selected";
}

function storeAction(store) {
  if (!store.zones.length) return { href: "/dashboard/locations", label: "Review shop setup" };
  if (!store.zones.some((zone) => zone.selectedSound)) return { href: "/dashboard/retail/music", label: "Choose music" };
  if (store.state === "HEALTHY" || store.state === "CLOSED") return { href: "/dashboard/retail/music", label: "Change music" };
  return { href: "/dashboard/players", label: "Check player" };
}

function StoreCard({ store, signageEnabled }) {
  const confirmed = store.zones.find((zone) => zone.recentPlayback);
  const action = storeAction(store);
  return <article className={styles.storeCard}>
    <div className={styles.storeTop}><div><h3>{store.name}</h3><p>{store.city || "Retail location"}</p></div><Status state={store.state} /></div>
    <div className={styles.storeOverview}>
      <p><span>Music</span><strong>{storeSound(store)}</strong></p>
      <p><span>Player</span><strong>{store.readyPlayerCount ? `${store.readyPlayerCount} ready` : store.playerCount ? "Not ready" : "Not set up"}</strong></p>
    </div>
    <Link className={styles.storePrimary} href={action.href}>{action.label} →</Link>
    <details className={styles.storeMore}>
      <summary>More about this shop</summary>
      <dl>
        <div><dt>Listening areas</dt><dd>{store.zones.length}</dd></div>
        <div><dt>Players ready</dt><dd>{store.readyPlayerCount} of {store.playerCount}</dd></div>
        <div><dt>Opening hours</dt><dd>{store.openingState === "UNKNOWN" ? "Not set" : store.openingState === "OPEN" ? "Open now" : "Closed now"}</dd></div>
        <div><dt>Promotions dated today</dt><dd>{store.promotionCount}</dd></div>
        {signageEnabled ? <div><dt>Displays connected</dt><dd>{store.onlineScreenCount} of {store.screenCount}</dd></div> : null}
      </dl>
      {confirmed ? <p>Recent audio reported in {confirmed.name}: {confirmed.recentPlayback.artist ? `${confirmed.recentPlayback.artist} — ` : ""}{confirmed.recentPlayback.title || "Audio item"}. This does not confirm what is playing right now.</p> : <p>No recent audio report is available. Check the player to confirm sound.</p>}
      {store.zones.length > 1 ? <ul aria-label={`${store.name} listening areas`}>{store.zones.map((zone) => <li key={zone.id}>{zone.name}: {STATUS[zone.state]?.label || "Setup needed"}</li>)}</ul> : null}
      <div className={styles.storeLinks}><Link href="/dashboard/players">All players</Link><Link href="/dashboard/retail/music">Shop music</Link></div>
    </details>
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

  return <main id="main-content" className={styles.page}><div className={styles.container}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>YOUR RETAIL RADIO</p><h1>{copy.title}</h1><p>{copy.detail}</p>
      <div className={styles.heroActions}><Link href="/dashboard/listen/retail" target="_blank" rel="noopener noreferrer">▶ Listen live</Link><Link href="/dashboard/retail/music">♫ Set up AutoDJ</Link></div>
      <div className={styles.nextStep}><div><span>YOUR NEXT STEP</span><strong>{next.title}</strong><p>{next.description}</p></div><Link href={next.href}>{next.label} →</Link></div>
      <small>{onboarding.completedCount} of {onboarding.totalCount} setup steps complete{complimentary ? " · Complimentary service" : ""}</small>
    </header>

    <section className={styles.quickTasks} aria-labelledby="tasks-title"><h2 id="tasks-title">What would you like to do?</h2><div className={styles.taskGrid}>
      <Link href="/dashboard/retail/music"><span aria-hidden="true">♫</span><strong>{summary.canManage ? "AutoDJ & shop music" : "View shop music"}</strong><small>Choose what plays and when</small></Link>
      <Link href="/dashboard/promotions"><span aria-hidden="true">✦</span><strong>{summary.canManage ? "Plan a promotion" : "View promotions"}</strong><small>Messages for your shops</small></Link>
      <Link href="/dashboard/players"><span aria-hidden="true">▣</span><strong>Check shop players</strong><small>See whether devices are ready</small></Link>
    </div></section>

    <section className={styles.shopsPanel} aria-labelledby="shops-title"><div className={styles.sectionHead}><div><h2 id="shops-title">Your shops</h2><p>{summary.counts.stores ? `${summary.counts.healthyStores} ready · ${summary.counts.attentionStores} need a check${summary.limited ? " · Showing a limited overview" : ""}` : "Your shop status will appear here"}</p></div><Link href="/dashboard/locations">All locations →</Link></div>
      {summary.stores.length > 4 ? <div className={styles.filters}><label>Find a shop<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or city" /></label><div role="group" aria-label="Filter shops">{[["ALL", "All"], ["ATTENTION", "Needs a check"], ["HEALTHY", "Ready"], ["CLOSED", "Closed"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? styles.activeFilter : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div> : null}
      {summary.stores.length ? <div className={styles.storeList}>{filteredStores.length ? filteredStores.map((store) => <StoreCard key={store.id} store={store} signageEnabled={summary.entitlements.digitalSignageEnabled} />) : <p className={styles.empty}>No shops match. Try another name or filter.</p>}</div> : <div className={styles.emptyState}><p>No retail locations yet. Ruvanas prepares the first location and listening area.</p><Link href="/dashboard/locations">Review location setup →</Link></div>}
    </section>

    {summary.attention.length ? <section className={styles.attentionPanel} aria-labelledby="attention-title"><h2 id="attention-title">Needs a check</h2><ul>{summary.attention.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.message}</span></div><Link href={item.href}>Review →</Link></li>)}</ul></section> : null}

    <details className={styles.moreDetails}><summary>Schedules, reports and more tools</summary><div className={styles.moreGrid}>
      <section><h2>Coming up today</h2><p>Plans shown in each shop's local time, not proof of playback.</p>{summary.timeline.length ? <ol className={styles.timeline}>{summary.timeline.map((event) => <li key={event.id}><time>{event.time}</time><span>{event.label} · {event.storeName}</span></li>)}</ol> : <p>No later published music slot today. Automatic music may still be set.</p>}<Link href="/dashboard/programming">Open detailed schedule →</Link></section>
      <section><h2>Recent activity</h2><p>{summary.recentPlayback ? `${summary.recentPlayback.artist ? `${summary.recentPlayback.artist} — ` : ""}${summary.recentPlayback.title || "Audio item"} was reported by ${summary.recentPlayback.storeName} within 15 minutes.` : "No recent audio report is available. Check a shop player to confirm sound."}</p><p>{summary.counts.promotionsToday} published {summary.counts.promotionsToday === 1 ? "promotion is" : "promotions are"} within today's date window. Play times may differ.</p><p>{summary.counts.readyPlayers} of {summary.counts.players} players ready.</p><Link href="/dashboard/reports">Open delivery reports →</Link></section>
      <section><h2>Other tools</h2><div className={styles.toolLinks}><Link href="/dashboard/studio">Studio</Link><Link href="/dashboard/analytics">Insights</Link>{summary.entitlements.digitalSignageEnabled ? <Link href="/dashboard/digital-signage">Digital signage</Link> : null}{summary.entitlements.retailMediaEnabled ? <Link href="/dashboard/retail-media">Retail media</Link> : null}</div></section>
    </div></details>
    <details className={styles.moreDetails}><summary>See all setup steps</summary><ol className={styles.setupList}>{onboarding.steps.map((step) => <li key={step.id}><span>{step.complete ? "Done" : step.status === "CURRENT" ? "Next" : "Later"}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div><Link href={step.href}>{step.actionLabel}</Link></li>)}</ol></details>
  </div></main>;
}
