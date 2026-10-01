import { notFound } from "next/navigation";
import { insideDemoFacilities } from "@/lib/inside-demo-scenario.mjs";
import ReviewWalkthrough from "./ReviewWalkthrough";
import styles from "./tour.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ruvanas Inside | Fictional demo tour",
  description: "A fictional, read-only tour of Ruvanas Inside governance. No real facilities, customer records, players or live audio.",
  robots: { index: false, follow: false }
};

const steps = [
  ["01", "Set the boundaries", "The authority defines central clean-content rules. Each facility can add tighter restrictions, never loosen music rights or permit explicit tracks."],
  ["02", "Create under supervision", "A contributor works in a supervised Studio session linked to a facility and programme. This tour does not record or upload audio."],
  ["03", "Submit an exact version", "Submission pins an immutable Studio render as pending review. Later edits need a new revision; submission is not approval."],
  ["04", "Review independently", "Authorised staff can approve, request changes or reject through Corrections Guard. Contributors cannot approve or schedule their own work."],
  ["05", "Schedule deliberately", "Only an approved version may become eligible for scheduling by authorised staff. Approval alone never starts playback."]
];

export default function InsideDemoTour() {
  if (process.env.RUVANAS_ENVIRONMENT !== "DEMO") notFound();

  return <main className={styles.page}>
    <a className={styles.skip} href="#tour">Skip to tour</a>
    <header className={styles.header}><a href="/" className={styles.brand}>RUVANAS</a><span>INSIDE · FICTIONAL DEMO</span><a href="/">Back to Ruvanas</a></header>
    <section className={styles.hero} id="tour">
      <p className={styles.eyebrow}>Explore without an account</p>
      <h1>Private media starts with <em>clear authority.</em></h1>
      <p className={styles.lead}>This read-only tour explains how Ruvanas Inside separates facility policy, supervised creation, staff review and later delivery. Every facility and programme shown here is fictional.</p>
      <div className={styles.warning}><strong>Demonstration only.</strong> No real facility, person, customer record, audio file or player is connected. Nothing on this page can schedule or broadcast.</div>
      <div className={styles.heroActions}>
        <a className={styles.jumpPrimary} href="#review-example">Try the fictional review →</a>
        <a className={styles.jump} href="#facilities">See the fictional facilities ↓</a>
      </div>
    </section>
    <section className={styles.section} id="facilities" aria-labelledby="facilities-title">
      <p className={styles.eyebrow}>A safe example network</p>
      <h2 id="facilities-title">Three facilities. One governed foundation.</h2>
      <p className={styles.subcopy}>The isolated demo database contains these fictional names and one offline area per facility. They illustrate structure, not active operations.</p>
      <div className={styles.facilities}>{insideDemoFacilities.map((facility, index) => <article className={styles.facility} key={facility.slug}>
        <span className={styles.index}>0{index + 1} · FICTIONAL</span><h3>{facility.name}</h3><p>{facility.zone} · Offline</p>
        <div className={styles.status}>{facility.draft ? <><strong>Unscheduled draft</strong><span>{facility.draft} has no audio and cannot be broadcast.</span></> : <><strong>No programme submitted</strong><span>No audio, schedule or connected player.</span></>}</div>
      </article>)}</div>
    </section>
    <section className={styles.section} aria-labelledby="workflow-title">
      <p className={styles.eyebrow}>The controlled path</p><h2 id="workflow-title">Creation is not permission to broadcast.</h2>
      <p className={styles.subcopy}>These are the intended governance stages; the public tour does not execute them or claim that live delivery has been accepted.</p>
      <ol className={styles.steps}>{steps.map(([number, title, description]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}</ol>
      <ReviewWalkthrough />
    </section>
    <section className={styles.boundary} aria-labelledby="boundary-title"><div><p className={styles.eyebrow}>Release boundary</p><h2 id="boundary-title">What is deliberately not live</h2></div><ul><li>No connected private player or live audio</li><li>No real facility, contributor or family request data</li><li>No public listener or automatic broadcast</li><li>No customer identity provider or approved retention policy</li><li>No claim that offline Edge delivery is release-ready</li></ul></section>
    <footer className={styles.footer}><a href="/">← Ruvanas home</a><p>Protected operational screens require a separate demo-owner sign-in. This public tour grants no account or facility access.</p></footer>
  </main>;
}
