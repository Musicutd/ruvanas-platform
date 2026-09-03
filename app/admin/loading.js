import styles from "./admin-dashboard.module.css";

export default function AdminLoading() {
  return (
    <div className={styles.loadingPage} aria-busy="true" aria-label="Loading administration analytics">
      <div className={styles.loadingHero} />
      <div className={styles.loadingControls} />
      <div className={styles.loadingMetrics}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
      <div className={styles.loadingPanels}><span /><span /></div>
      <p>Preparing current platform analytics…</p>
    </div>
  );
}
