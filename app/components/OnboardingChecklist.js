import Link from "next/link";
import styles from "./onboarding-checklist.module.css";

export default function OnboardingChecklist({ onboarding }) {
  const progressLabel = `${onboarding.completedCount} of ${onboarding.totalCount} complete`;

  return (
    <details className={styles.guide} open={!onboarding.complete} id="first-use-setup">
      <summary>
        <span>
          <strong>{onboarding.complete ? "First setup complete" : "Set up your first radio service"}</strong>
          <small>{progressLabel} · Select to hide or show this guide</small>
        </span>
        <span className={onboarding.complete ? styles.completeBadge : styles.progressBadge}>
          {onboarding.complete ? "Ready" : progressLabel}
        </span>
      </summary>
      <div className={styles.body}>
        <p className={styles.introduction}>
          Progress comes from your real station, programme and player status. Complete your tasks in order; Ruvanas-managed steps update automatically when they are ready.
        </p>
        <ol className={styles.steps}>
          {onboarding.steps.map((step, index) => (
            <li key={step.id} data-status={step.status} aria-current={step.status === "CURRENT" ? "step" : undefined}>
              <span className={styles.marker} aria-hidden="true">{step.complete ? "✓" : index + 1}</span>
              <div className={styles.copy}>
                <span className={styles.owner}>{step.owner}</span>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
                {step.status === "CURRENT" ? <Link href={step.href}>{step.actionLabel}</Link> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
