"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./partner-demo.module.css";

const distributorExamples = [
  { label: "Catalogue import", detail: "Example release and track identifiers, ISRC, artist, title, genre and explicit-content checks." },
  { label: "Rights and tiers", detail: "Example mapping from approved collections to plan catalogue levels, territories, product uses and licence windows." },
  { label: "Updates and takedowns", detail: "Example sequence for new releases, changed rights and immediate takedown processing." },
  { label: "Usage and reconciliation", detail: "Example completed-play reporting, delivery status, mismatch review and audit evidence." }
];

function SampleRetailMusicSetup() {
  const [area, setArea] = useState("Main shop / Sales floor");
  const [music, setMusic] = useState("Calm daytime mix");
  const [hours, setHours] = useState("During shop hours");
  return <div className={styles.sampleSetup}>
    <h3>Try a sample music setup</h3><p>Change these choices to see the customer journey. This is a local preview; it cannot save or start playback.</p>
    <div className={styles.sampleFields}>
      <label>Shop area<select value={area} onChange={(event) => setArea(event.target.value)}><option>Main shop / Sales floor</option><option>Main shop / Café</option></select></label>
      <label>Approved music<select value={music} onChange={(event) => setMusic(event.target.value)}><option>Calm daytime mix</option><option>Upbeat afternoon mix</option></select></label>
      <label>Playback time<select value={hours} onChange={(event) => setHours(event.target.value)}><option>During shop hours</option><option>All day, every day</option></select></label>
    </div>
    <div className={styles.sampleResult}><strong>Preview only</strong><span>{area} would use {music.toLowerCase()} · {hours.toLowerCase()}.</span></div>
  </div>;
}

export default function PartnerDemoTour({ partnerName, adminPreview, products }) {
  const [tab, setTab] = useState("overview");
  const selected = products.find((product) => product.id === tab);

  return <main className={styles.demoPage} id="main-content">
    <header className={styles.demoHeader}><div><p className={styles.eyebrow}>RUVANAS · PARTNER TOUR</p><h1>Explore the platform</h1><p>Welcome, {partnerName}. See how subscriber-operated media works across six specialised products.</p></div>
      {adminPreview ? <Link href="/admin/partner-demos">Back to invitations</Link> : <form action="/api/partner-demo/logout" method="post"><button className={styles.signOut}>End demo session</button></form>}
    </header>
    <div className={styles.sampleBanner} role="note"><strong>Read-only sample experience</strong><span>No customer records, live music, passwords, API keys, account controls or real rights data are available here. Nothing on this page publishes or changes a service.</span></div>

    <nav className={styles.tabs} aria-label="Partner demo sections">
      <button type="button" onClick={() => setTab("overview")} aria-current={tab === "overview" ? "page" : undefined}>Overview</button>
      {products.map((product) => <button type="button" key={product.id} onClick={() => setTab(product.id)} aria-current={tab === product.id ? "page" : undefined}>{product.tabLabel}</button>)}
      <button type="button" onClick={() => setTab("distributor")} aria-current={tab === "distributor" ? "page" : undefined}>Music distributor</button>
    </nav>

    {tab === "overview" ? <section className={styles.panel} aria-labelledby="overview-title">
      <p className={styles.eyebrow}>ONE SHARED CORE</p><h2 id="overview-title">Six products, one controlled workflow</h2>
      <p>Ruvanas supplies the technology. Each subscriber operates its own content, channels, players and approvals within its organisation.</p>
      <div className={styles.cardGrid}>{[
        ["1 · Prepare", "Set up the organisation, locations, channels and authorised team."],
        ["2 · Create", "Choose rights-cleared audio, announcements, programmes or displays."],
        ["3 · Review", "Check product rules, territory, approvals and publishing readiness."],
        ["4 · Deliver", "Publish to the selected players, streams, podcasts or screens."],
        ["5 · Verify", "Use operational status and proof-of-play evidence to see what actually happened."]
      ].map(([title, detail]) => <article key={title}><h3>{title}</h3><p>{detail}</p></article>)}</div>
      <h3>What the platform team oversees</h3>
      <div className={styles.cardGrid}>{[
        ["Plan access", "Sample view of product tiers and allowances; partners cannot edit or grant them."],
        ["Music rights", "Sample view of catalogue eligibility, territory checks and takedown status."],
        ["Device health", "Sample view of online players and delivery alerts, without exposing real shops."],
        ["Product QA", "Sample launch checks and issue status; no live controls are available."]
      ].map(([title, detail]) => <article key={title}><h3>{title}</h3><p>{detail}</p></article>)}</div>
      <p className={styles.hint}>Choose a product tab to see its detailed process. The Music distributor tab shows the intended integration and rights flow using examples only.</p>
    </section> : null}

    {selected ? <section className={styles.panel} aria-labelledby="product-title"><p className={styles.eyebrow}>{selected.tabDescription}</p><h2 id="product-title">{selected.title}</h2><p>{selected.introduction}</p><p className={styles.outcome}><strong>Outcome:</strong> {selected.outcome}</p>
      {selected.id === "retail" ? <SampleRetailMusicSetup /> : null}
      <div className={styles.chapters}>{selected.chapters.map((chapter) => <details key={chapter.title}><summary><strong>{chapter.title}</strong><span>{chapter.summary}</span></summary><div><p>{chapter.detail}</p><ol>{chapter.steps.map((step) => <li key={step}>{step}</li>)}</ol></div></details>)}</div>
    </section> : null}

    {tab === "distributor" ? <section className={styles.panel} aria-labelledby="distributor-title"><p className={styles.eyebrow}>INTEGRATION PREVIEW · SAMPLE DATA</p><h2 id="distributor-title">How a licensed catalogue could connect</h2>
      <p>This illustrates the current integration workflow; an actual distributor connection and music use require agreed API terms, territory rights and product-use approval.</p>
      <div className={styles.cardGrid}>{distributorExamples.map((item) => <article key={item.label}><h3>{item.label}</h3><p>{item.detail}</p></article>)}</div>
      <div className={styles.sampleRecord}><h3>Illustrative track record</h3><dl><div><dt>Track</dt><dd>Sample Track A · Sample Artist</dd></div><div><dt>ISRC</dt><dd>EX-ABC-26-00001 (example)</dd></div><div><dt>Use</dt><dd>Retail playback · Malta (example)</dd></div><div><dt>Tier</dt><dd>Focused collection (example)</dd></div><div><dt>Status</dt><dd>Awaiting licence verification</dd></div></dl></div>
      <p className={styles.hint}>This tour does not connect to a distributor API or expose licensed audio files.</p>
    </section> : null}

    <footer className={styles.footer}>Ruvanas partner demonstration · sample information only · read-only</footer>
  </main>;
}
