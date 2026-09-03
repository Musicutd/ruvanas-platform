"use client";

import styles from "./admin-dashboard.module.css";

export default function AdminError({ reset }) {
  return (
    <div className={styles.errorState} role="alert">
      <span aria-hidden="true">!</span>
      <p className={styles.eyebrow}>ANALYTICS UNAVAILABLE</p>
      <h1>The command centre could not load</h1>
      <p>Your administration tools remain protected. Try loading the current platform information again.</p>
      <button type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
