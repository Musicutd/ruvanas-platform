"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./subscriber-portal-shell.module.css";

function matchesPath(pathname, href) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SubscriberPortalShell({ navigation, organisationName, userName, membershipRole, children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeSectionId = navigation.find((section) => section.items.some((item) => item.available !== false && matchesPath(pathname, item.href)))?.id;
  const [expandedSections, setExpandedSections] = useState(() => new Set([activeSectionId || navigation[0]?.id].filter(Boolean)));

  useEffect(() => {
    if (!activeSectionId) return;
    setExpandedSections((current) => new Set([...current, activeSectionId]));
  }, [activeSectionId]);

  function toggleSection(sectionId) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  return (
    <div className={styles.portal}>
      <header className={styles.topbar}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="subscriber-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close menu" : "Menu"}
        </button>
        <div className={styles.organisation}>
          <span>{organisationName}</span>
          <small>{membershipRole.replaceAll("_", " ").toLowerCase()}</small>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={styles.signOut}>Sign out</button>
        </form>
      </header>

      <div className={styles.workspace}>
        <aside id="subscriber-navigation" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
          <div className={styles.identity}>
            <span>Signed in as</span>
            <strong>{userName}</strong>
          </div>
          <nav aria-label="Subscriber portal">
            <Link
              href="/dashboard"
              className={pathname === "/dashboard" ? styles.activeHome : styles.home}
              aria-current={pathname === "/dashboard" ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <span>Overview</span><b aria-hidden="true">⌂</b>
            </Link>
            {navigation.map((section) => {
              const expanded = expandedSections.has(section.id);
              return (
                <section className={styles.navSection} key={section.id}>
                  <button
                    type="button"
                    className={styles.navSectionButton}
                    aria-expanded={expanded}
                    aria-controls={`subscriber-navigation-${section.id}`}
                    onClick={() => toggleSection(section.id)}
                  >
                    <span>
                      <strong>{section.label}</strong>
                      {expanded ? <small>{section.description}</small> : null}
                    </span>
                    <b aria-hidden="true">{expanded ? "−" : "+"}</b>
                  </button>
                  <ul id={`subscriber-navigation-${section.id}`} hidden={!expanded}>
                    {section.items.map((item) => {
                      const active = item.available !== false && matchesPath(pathname, item.href);
                      return <li key={item.id || item.href}>
                        <Link
                          href={item.href}
                          className={active ? styles.activeLink : item.available === false ? styles.lockedLink : styles.link}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setOpen(false)}
                        >
                          <span>{item.label}</span>
                          {item.available === false ? <small>Not included</small> : null}
                        </Link>
                      </li>;
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
        </aside>
        {open ? <button type="button" className={styles.scrim} aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
