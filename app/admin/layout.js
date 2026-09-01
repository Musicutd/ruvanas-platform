import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";
import { buildAdminNavigation } from "@/lib/user-experience-navigation.mjs";
import styles from "./admin-navigation.module.css";

export default async function AdminLayout({ children }) {
  const adminUser = await getAdminUser();
  if (!adminUser) redirect("/login");

  const navigation = buildAdminNavigation(adminUser.role);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topbar}>
          <div>
            <Link href="/admin/organisations" className={styles.brand}>Ruvanas Admin</Link>
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

        <nav className={styles.navigation} aria-label="Admin navigation">
          <div className={styles.navigationInner}>
            {navigation.map((section) => (
              <details className={styles.group} key={section.id}>
                <summary>
                  <span>{section.label}</span>
                  <small>{section.description}</small>
                </summary>
                <div className={styles.links}>
                  {section.items.map((item) => (
                    <Link key={item.href} href={item.href}>{item.label}</Link>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
