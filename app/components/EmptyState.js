import Link from "next/link";
import styles from "./interface-patterns.module.css";

export default function EmptyState({ title, description, actionHref, actionLabel, tone = "light", compact = false }) {
  return <section className={`${styles.emptyState} ${styles[tone]} ${compact ? styles.compact : ""}`} aria-labelledby="empty-state-title">
    <span className={styles.emptyMark} aria-hidden="true">✓</span>
    <div>
      <h2 id="empty-state-title" className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyDescription}>{description}</p>
      {actionHref && actionLabel ? <Link href={actionHref} className={styles.emptyAction}>{actionLabel}</Link> : null}
    </div>
  </section>;
}
