import styles from "./workflow-progress.module.css";

export default function WorkflowProgress({ title = "Setup progress", steps, tone = "dark" }) {
  return (
    <section className={`${styles.progress} ${styles[tone]}`} aria-label={title}>
      <p>{title}</p>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id} data-status={step.status}>
            <span className={styles.marker} aria-hidden="true">
              {step.status === "COMPLETE" ? "✓" : index + 1}
            </span>
            <span className={styles.copy}>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
