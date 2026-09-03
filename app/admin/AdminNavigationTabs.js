"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin-navigation.module.css";

function matchesPath(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNavigationTabs({ navigation }) {
  const pathname = usePathname();
  const activeSection = navigation.find((section) =>
    section.items.some((item) => matchesPath(pathname, item.href))
  ) || null;
  const overviewActive = pathname === "/admin";

  return (
    <nav className={styles.navigation} aria-label="Administration sections">
      <div className={styles.tabs} role="tablist" aria-label="Administration areas">
        <Link
          href="/admin"
          className={overviewActive ? styles.activeTab : styles.tab}
          aria-current={overviewActive ? "page" : undefined}
          role="tab"
          aria-selected={overviewActive}
        >
          Overview
        </Link>
        {navigation.map((section) => {
          const active = activeSection?.id === section.id;
          return (
            <Link
              key={section.id}
              href={section.items[0].href}
              className={active ? styles.activeTab : styles.tab}
              aria-current={active ? "page" : undefined}
              role="tab"
              aria-selected={active}
            >
              {section.label}
            </Link>
          );
        })}
      </div>

      {activeSection ? (
        <div className={styles.subNavigation} aria-label={`${activeSection.label} tools`}>
          <div className={styles.subNavigationIntro}>
            <strong>{activeSection.label}</strong>
            <span>{activeSection.description}</span>
          </div>
          <div className={styles.subNavigationLinks}>
            {activeSection.items.map((item) => {
              const active = matchesPath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? styles.activeSubLink : styles.subLink}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
