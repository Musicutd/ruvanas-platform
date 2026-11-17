import styles from "./pilot-business-shell.module.css";
import PilotSignOutButton from "./PilotSignOutButton";

export default function PilotBusinessShell({ session, children }) {
  const admin = session.user.role === "SUPER_ADMIN";
  const landing = session.pilotLanding;
  return <div className={styles.page}>
    <header className={styles.header}><div className={styles.inner}>
      <a className={styles.brand} href={landing}><span>RUVANAS</span> Rewards pilot</a>
      <div className={styles.identity}><span>{session.user.name || session.user.email}</span><strong>{admin ? "Super Admin" : "Business account"}</strong></div>
      <nav aria-label="Private Rewards workspace"><a href={landing}>{admin ? "Pilot setup" : landing.endsWith("/redeem") ? "Shop checkout" : "Rewards workspace"}</a></nav>
      <PilotSignOutButton />
    </div></header>
    <p className={styles.notice}>Private Rewards pilot · Your existing permissions still apply. Public registration remains closed.</p>
    <div>{children}</div>
  </div>;
}
