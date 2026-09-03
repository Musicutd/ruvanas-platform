import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";
import { buildAdminNavigation } from "@/lib/user-experience-navigation.mjs";
import AdminNavigationTabs from "./AdminNavigationTabs";
import styles from "./admin-navigation.module.css";

export default async function AdminLayout({ children }) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");

  const navigation = buildAdminNavigation(adminUser.role);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topbar}>
          <div className={styles.brandArea}>
            <Link href="/admin" className={styles.brand}>RUVANAS</Link>
            <span className={styles.adminLabel}>Administration</span>
            <span className={styles.identity}>
              {adminUser.name || adminUser.email} · {adminUser.role.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <div className={styles.actions}>
            <Link href="/dashboard" className={styles.clientLink}>Client home</Link>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className={styles.signOut}>Sign out</button>
            </form>
          </div>
        </div>

        <AdminNavigationTabs navigation={navigation} />
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
