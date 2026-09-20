import Link from "next/link";
import styles from "./product-dashboard.module.css";
import WorkspaceTabs from "./WorkspaceTabs";

export default function ProductDashboard({ eyebrow, title, description, status, statusTone = "healthy", metrics, primaryAction, listenAction, sections, complimentary, onboarding, quickTasks = [] }) {
  const heroAction = onboarding && !onboarding.complete ? onboarding.nextAction : primaryAction;

  return (
    <main className={styles.page} id="main-content">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className={styles.heroActions}>
            <Link href={heroAction.href} className={styles.primary}>{heroAction.label}</Link>
            {listenAction ? <Link href={listenAction.href} className={styles.secondary} target="_blank" rel="noopener noreferrer">▶ {listenAction.label}</Link> : null}
          </div>
          <div className={styles.utilityLinks}>
            <Link href="/dashboard/how-it-works">How it works</Link>
            <Link href="/dashboard">All products</Link>
          </div>
        </div>
        <aside className={styles.statusCard} aria-label={`${title} service status`}>
          <span className={statusTone === "healthy" ? styles.healthyDot : styles.attentionDot} aria-hidden="true" />
          <small>Service status</small>
          <strong>{status}</strong>
          {complimentary ? <p>Complimentary service · active until Ruvanas stops it</p> : <p>Managed through your organisation plan</p>}
        </aside>
      </header>

      {onboarding ? (
        <section className={styles.onboarding} aria-labelledby="product-onboarding-title">
          <div className={styles.onboardingHeading}>
            <div>
              <p className={styles.eyebrow}>GUIDED LAUNCH · YOUR NEXT STEP</p>
              <h2 id="product-onboarding-title">{onboarding.complete ? `${onboarding.product} is ready` : onboarding.nextAction.title}</h2>
              <p>{onboarding.nextAction.description}</p>
            </div>
            <div className={styles.progressBlock}>
              <strong>{onboarding.completedCount} of {onboarding.totalCount}</strong>
              <span>launch checks complete</span>
              <progress value={onboarding.completedCount} max={onboarding.totalCount} aria-label={`${onboarding.percent}% of ${onboarding.product} setup complete`} />
            </div>
          </div>

          <details className={styles.setupDetails}>
            <summary>See all {onboarding.totalCount} setup steps</summary>
            <ol className={styles.checklist}>
              {onboarding.steps.map((step, index) => (
                <li key={step.id} className={step.complete ? styles.stepComplete : step.status === "CURRENT" ? styles.stepCurrent : styles.stepUpcoming} aria-current={step.status === "CURRENT" ? "step" : undefined}>
                  <span className={styles.stepNumber} aria-hidden="true">{step.complete ? "✓" : index + 1}</span>
                  <div>
                    <small>{step.owner}</small>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                    {step.status === "CURRENT" ? <Link href={step.href}>{step.actionLabel} →</Link> : null}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}

      {quickTasks.length ? <section className={styles.quickTasks} aria-labelledby="product-quick-tasks-title">
        <div>
          <p className={styles.eyebrow}>COMMON TASKS</p>
          <h2 id="product-quick-tasks-title">What would you like to do?</h2>
        </div>
        <div className={styles.quickTaskGrid}>
          {quickTasks.slice(0, 3).map((task) => <Link href={task.href} key={task.href} className={styles.quickTask}>
            <strong>{task.label}</strong><span>{task.description}</span><b aria-hidden="true">→</b>
          </Link>)}
        </div>
        {quickTasks.length > 3 ? <details className={styles.extraTasks}>
          <summary>More common tasks</summary>
          <div className={styles.quickTaskGrid}>
            {quickTasks.slice(3).map((task) => <Link href={task.href} key={task.href} className={styles.quickTask}>
              <strong>{task.label}</strong><span>{task.description}</span><b aria-hidden="true">→</b>
            </Link>)}
          </div>
        </details> : null}
      </section> : null}

      {metrics?.length ? <details className={styles.metricsDetails}>
        <summary>View service numbers</summary>
        <section className={styles.metrics} aria-label={`${title} overview`}>
          {metrics.map((metric) => <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>)}
        </section>
      </details> : null}

      <WorkspaceTabs
        label="All tools"
        intro="Everything else is here when you need it. Choose a category to explore."
        tabs={sections.map((section) => ({
          id: section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          label: section.title,
          description: section.eyebrow
        }))}
      >
        {sections.map((section) => <section key={section.title} className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>{section.eyebrow}</p>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
          </div>
          <div className={styles.actionList}>
            {section.actions.slice(0, 4).map((action) => <Link href={action.href} key={`${action.href}:${action.label}`} className={styles.action}>
              <span><strong>{action.label}</strong><small>{action.description}</small></span>
              <b aria-hidden="true">→</b>
            </Link>)}
            {section.actions.length > 4 ? <details className={styles.moreActions}>
              <summary>More {section.title.toLowerCase()} options ({section.actions.length - 4})</summary>
              <div className={styles.moreActionList}>
                {section.actions.slice(4).map((action) => <Link href={action.href} key={`${action.href}:${action.label}`} className={styles.action}>
                  <span><strong>{action.label}</strong><small>{action.description}</small></span>
                  <b aria-hidden="true">→</b>
                </Link>)}
              </div>
            </details> : null}
          </div>
        </section>)}
      </WorkspaceTabs>
    </main>
  );
}
