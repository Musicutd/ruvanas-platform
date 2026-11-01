import Link from "next/link";
import styles from "./retail-control-centre.module.css";

export default function RetailPlanningHome({ stationName }) {
  const workspace = "/dashboard/programming?product=RETAIL";
  return <main id="main-content" className={styles.page}><div className={styles.container}>
    <header className={styles.hero}>
      <p className={styles.eyebrow}>YOUR RETAIL RADIO · {stationName || "TEST RETAIL"}</p>
      <h1>Your music. Your messages. All your shops.</h1>
      <p>One shared radio programme for your shops. Listen, choose music or plan a message from here.</p>
      <div className={styles.heroActions}><Link href="/dashboard/listen/retail">▶ Listen now</Link><Link href={`${workspace}#workspace-commercials`}>Manage commercials →</Link></div>
      <p className={styles.planningHint}>You can listen and plan here without setting up a shop device first.</p>
    </header>
    <section className={styles.quickTasks} aria-labelledby="retail-planning-tasks"><h2 id="retail-planning-tasks">What would you like to do?</h2><div className={`${styles.taskGrid} ${styles.planningTasks}`}>
      <Link href="/dashboard/listen/retail"><span aria-hidden="true">▶</span><strong>Listen</strong><small>Open your shop radio player</small></Link>
      <Link href={`${workspace}#workspace-autodj`}><span aria-hidden="true">♫</span><strong>Music & AutoDJ</strong><small>Browse music and plan genre mixes</small></Link>
      <Link href={`${workspace}#workspace-planner`}><span aria-hidden="true">▦</span><strong>Weekly planner</strong><small>Choose music for a day and time</small></Link>
      <Link href={`${workspace}#workspace-commercials`}><span aria-hidden="true">◉</span><strong>Commercials</strong><small>Upload a message and choose when it plays</small></Link>
    </div></section>
    <nav className={styles.libraryLinks} aria-label="More music choices"><Link href={`${workspace}#workspace-library`}>Browse music library →</Link><Link href={`${workspace}#workspace-simple`}>Playlists & templates →</Link></nav>
    <section className={styles.simpleApproval} aria-labelledby="retail-shared-plan"><h2 id="retail-shared-plan">You decide when your messages go on air</h2><p>Approve your recording, choose its timing, then approve the saved commercial schedule. Saving a draft alone does not change the stream. Weekly music plans still need administrator approval.</p></section>
    <details className={styles.moreDetails}><summary>Set up a shop device</summary><div className={styles.setupHelp}><p>Use this when you are ready to connect a device in a shop. It is separate from listening here or planning music and commercials.</p><Link href="/dashboard/players">Open shop device setup →</Link><Link href="/dashboard/locations">Manage shop locations →</Link></div></details>
  </div></main>;
}
