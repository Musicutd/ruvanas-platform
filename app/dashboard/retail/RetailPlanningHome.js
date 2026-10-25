import Link from "next/link";
import styles from "./retail-control-centre.module.css";

export default function RetailPlanningHome({ stationName }) {
  const workspace = "/dashboard/programming?product=RETAIL";
  return <main id="main-content" className={styles.page}><div className={styles.container}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>YOUR RETAIL RADIO · {stationName || "TEST RETAIL"}</p>
      <h1>One music plan for all your shops</h1>
      <p>Explore your approved catalogue, build a playlist and plan your week. Save drafts for your administrator to review before anything goes on air.</p>
      <div className={styles.heroActions}><Link href={`${workspace}#workspace-library`}>Open music library →</Link><Link href={`${workspace}#workspace-planner`}>Weekly planner →</Link></div>
      <div className={styles.nextStep}><div><span>YOUR WORKSPACE</span><strong>Music library → Playlists → Weekly planner</strong><p>One shared Retail programme. You can prepare music before adding individual shop locations.</p></div><Link href={`${workspace}#workspace-simple`}>Build a playlist →</Link></div>
    </header>
    <section className={styles.quickTasks} aria-labelledby="retail-planning-tasks"><h2 id="retail-planning-tasks">What would you like to do?</h2><div className={styles.taskGrid}>
      <Link href={`${workspace}#workspace-library`}><span aria-hidden="true">♫</span><strong>Music library</strong><small>Search approved songs, artists and genres</small></Link>
      <Link href={`${workspace}#workspace-simple`}><span aria-hidden="true">☷</span><strong>Playlists & templates</strong><small>Generate a mix or load a saved playlist</small></Link>
      <Link href={`${workspace}#workspace-planner`}><span aria-hidden="true">▦</span><strong>Weekly planner</strong><small>Save programmes as a draft for review</small></Link>
    </div></section>
    <section className={styles.shopsPanel} aria-labelledby="retail-shared-plan"><h2 id="retail-shared-plan">Drafts stay separate from your stream</h2><p>Your administrator manages on-air approval, the streaming connection and shop access. These planning tools do not start or stop audio, change plan allowances or affect other stations.</p><Link href="/dashboard/locations">View shop locations →</Link></section>
  </div></main>;
}
