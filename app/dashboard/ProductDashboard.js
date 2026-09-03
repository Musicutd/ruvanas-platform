import Link from "next/link";
import styles from "./product-dashboard.module.css";

export default function ProductDashboard({ eyebrow, title, description, status, statusTone = "healthy", metrics, primaryAction, sections, complimentary }) {
  return (
    <main className={styles.page} id="main-content">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className={styles.heroActions}>
            <Link href={primaryAction.href} className={styles.primary}>{primaryAction.label}</Link>
            <Link href="/dashboard" className={styles.secondary}>All products</Link>
          </div>
        </div>
        <aside className={styles.statusCard} aria-label={`${title} service status`}>
          <span className={statusTone === "healthy" ? styles.healthyDot : styles.attentionDot} aria-hidden="true" />
          <small>Service status</small>
          <strong>{status}</strong>
          {complimentary ? <p>Complimentary service · active until Ruvanas stops it</p> : <p>Managed through your organisation plan</p>}
        </aside>
      </header>

      <section className={styles.metrics} aria-label={`${title} overview`}>
        {metrics.map((metric) => <article key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.detail}</small>
        </article>)}
      </section>

      <div className={styles.sectionGrid}>
        {sections.map((section) => <section key={section.title} className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>{section.eyebrow}</p>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
          </div>
          <div className={styles.actionList}>
            {section.actions.map((action) => <Link href={action.href} key={`${action.href}:${action.label}`} className={styles.action}>
              <span><strong>{action.label}</strong><small>{action.description}</small></span>
              <b aria-hidden="true">→</b>
            </Link>)}
          </div>
        </section>)}
      </div>
    </main>
  );
}
