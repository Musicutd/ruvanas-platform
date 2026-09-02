import Link from "next/link";
import styles from "./interface-patterns.module.css";

export default function PageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = "Back",
  tone = "light",
  children
}) {
  return <header className={`${styles.pageHeader} ${styles[tone]}`} aria-labelledby="page-title">
    <div className={styles.headerCopy}>
      {backHref ? <Link href={backHref} className={styles.backLink}>← {backLabel}</Link> : null}
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 id="page-title" className={styles.pageTitle}>{title}</h1>
      {description ? <p className={styles.description}>{description}</p> : null}
    </div>
    {children ? <div className={styles.headerActions}>{children}</div> : null}
  </header>;
}
