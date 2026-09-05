import DjAccessClient from "./DjAccessClient";
import styles from "./access.module.css";

export const metadata = { title: "DJ Access | Ruvanas" };

export default function DjAccessPage() {
  return <main className={styles.page}><header className={styles.header}><a href="/" className={styles.brand}>RUVANAS</a><a href="/dashboard" className={styles.back}>Open dashboard</a></header><section className={styles.shell}><DjAccessClient /></section></main>;
}

