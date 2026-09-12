"use client";

import { useState } from "react";
import StudioWorkspaceClient from "../school-radio/StudioWorkspaceClient";
import ManualPlayoutClient from "./ManualPlayoutClient";
import StudioBroadcastClient from "./StudioBroadcastClient";
import ProductionServiceClient from "./StudioClient";
import styles from "./studio-pro.module.css";

const tabs = [
  ["create", "Create & edit", "Projects, Waveform and Multitrack"],
  ["playout", "Manual Playout", "Live Playlist, Prepare and Library"],
  ["broadcast", "Broadcast", "Managed and external destinations"],
  ["service", "Production service", "Request work from the Ruvanas team"]
];

const productGuidance = Object.freeze({
  RETAIL: "Retail teams control their own promotions, branches and approved commercial output.",
  SCHOOL: "School staff retain supervision, safeguarding approval and control of student output.",
  ONLINE: "The subscriber controls programmes, podcasts and listener-facing publication.",
  HEALTH: "The subscriber is responsible for clinical review, accessibility and content approval. Ruvanas provides production technology, not clinical content or advice.",
  FAITH: "The subscriber is responsible for ministry review and content approval. Ruvanas provides production technology, not religious content or doctrine.",
  ORGANISATIONS: "The subscriber controls announcements, events and public communications; Ruvanas does not operate the organisation's channel."
});

export default function StudioHubClient({ entitlements }) {
  const [tab, setTab] = useState("create");
  return <main className={styles.page}>
    <a href="/dashboard" className={styles.back}>← Dashboard</a>
    <header className={styles.hero}><div><p>RUVANAS STUDIO · {entitlements.studioLevel}</p><h1>Create, prepare and broadcast from one workspace</h1><span>Studio Basic is included with Tiers 1–2. Studio Pro is included with Tiers 3–5. Catalogue rights remain separate.</span><span>{productGuidance[entitlements.planProductFamily] || "The subscriber operates and approves its own service; Ruvanas supplies the technology."}</span></div><strong>{entitlements.planName}</strong></header>
    <nav className={styles.tabs} role="tablist" aria-label="Ruvanas Studio workspaces">{tabs.map(([id, label, description]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><strong>{label}</strong><small>{description}</small>{["playout", "broadcast"].includes(id) && !entitlements.studioProEnabled ? <em>PRO</em> : null}</button>)}</nav>
    <section role="tabpanel" hidden={tab !== "create"}><StudioWorkspaceClient /></section>
    <section role="tabpanel" hidden={tab !== "playout"}><ManualPlayoutClient enabled={entitlements.studioProEnabled} /></section>
    <section role="tabpanel" hidden={tab !== "broadcast"}><StudioBroadcastClient enabled={entitlements.studioProEnabled} /></section>
    <section role="tabpanel" hidden={tab !== "service"}><ProductionServiceClient embedded /></section>
  </main>;
}
