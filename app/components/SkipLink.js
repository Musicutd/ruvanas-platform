import styles from "./interface-patterns.module.css";

export default function SkipLink({ target = "main-content", label = "Skip to main content" }) {
  return <a href={`#${target}`} className={styles.skipLink}>{label}</a>;
}
