import Link from "next/link";
import HowItWorksClient from "@/app/dashboard/how-it-works/HowItWorksClient";
import styles from "./public-how-it-works.module.css";

export const metadata = {
  title: "How Ruvanas works",
  description: "See how Ruvanas Retail Radio, School Radio and Online Radio work before creating an account."
};

export default function PublicHowItWorksPage() {
  return (
    <div className={styles.publicPage}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Ruvanas home">RUVANAS</Link>
        <nav aria-label="Public navigation">
          <Link href="/">Home</Link>
          <Link href="/login">Log in</Link>
          <Link href="/register" className={styles.register}>Create account</Link>
        </nav>
      </header>
      <HowItWorksClient publicView />
    </div>
  );
}
