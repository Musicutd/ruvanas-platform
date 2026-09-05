import BrowserStudioClient from "./BrowserStudioClient";
import styles from "./studio.module.css";

export const metadata = { title: "Browser Live Studio | Ruvanas" };

export default function BrowserLiveStudioPage() {
  return <main className={styles.page}><header className={styles.header}><a href="/" className={styles.brand}>RUVANAS</a><a href="/dj/access" className={styles.back}>Presenter access</a></header><section className={styles.shell}><BrowserStudioClient /></section></main>;
}
