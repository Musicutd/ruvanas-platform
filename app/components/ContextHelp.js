import Link from "next/link";
import styles from "./interface-patterns.module.css";

export default function ContextHelp({ title = "Need help?", introduction, items = [], tone = "dark", articleHref, articleLabel = "Open full help" }) {
  return (
    <details className={`${styles.contextHelp} ${styles[tone]}`}>
      <summary>{title}</summary>
      <div className={styles.contextHelpBody}>
        {introduction ? <p>{introduction}</p> : null}
        {items.length ? <ul>{items.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.description}</span>
          </li>
        ))}</ul> : null}
        {articleHref ? <Link href={articleHref} className={styles.contextHelpLink}>{articleLabel} →</Link> : null}
      </div>
    </details>
  );
}
