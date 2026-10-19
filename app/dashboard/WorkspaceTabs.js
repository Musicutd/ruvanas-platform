"use client";

import { Children, useEffect, useId, useMemo, useRef, useState } from "react";
import { workspaceTabFromHash } from "@/lib/workspace-tab-navigation.mjs";
import styles from "./workspace-tabs.module.css";

export default function WorkspaceTabs({ label, intro, tabs, children, defaultTab }) {
  const instanceId = useId().replaceAll(":", "");
  const panels = Children.toArray(children);
  const availableTabs = useMemo(() => tabs.filter((tab, index) => tab && panels[index]), [tabs, panels]);
  const tabIdsKey = availableTabs.map((tab) => tab.id).join("|");
  const firstTab = availableTabs.find((tab) => tab.id === defaultTab)?.id || availableTabs[0]?.id || "";
  const [activeId, setActiveId] = useState(firstTab);
  const [visited, setVisited] = useState(() => new Set(firstTab ? [firstTab] : []));
  const tabRefs = useRef([]);
  const tabListRef = useRef(null);

  useEffect(() => {
    function syncHash(event) {
      const nextId = workspaceTabFromHash(window.location.hash, availableTabs.map((tab) => tab.id), firstTab);
      if (!nextId) return; // Programme-day and other in-panel anchors must not switch tools.
      setActiveId(nextId);
      setVisited((current) => new Set([...current, nextId]));
      if (event?.type === "hashchange") tabRefs.current[availableTabs.findIndex((tab) => tab.id === nextId)]?.focus({ preventScroll: true });
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [firstTab, tabIdsKey]);

  useEffect(() => {
    function revealActiveTab() {
      const index = availableTabs.findIndex((tab) => tab.id === activeId);
      const tab = tabRefs.current[index], list = tabListRef.current;
      if (!tab || !list) return;
      const selected = tab.getBoundingClientRect(), visible = list.getBoundingClientRect();
      const left = selected.left < visible.left ? selected.left - visible.left : selected.right > visible.right ? selected.right - visible.right : 0;
      if (left) list.scrollBy({ left, behavior: "auto" }); // Horizontal only: keep the heading in view on first load.
    }
    revealActiveTab();
    window.addEventListener("resize", revealActiveTab);
    return () => window.removeEventListener("resize", revealActiveTab);
  }, [activeId, tabIdsKey]);

  function selectTab(tabId, updateUrl = true) {
    setActiveId(tabId);
    setVisited((current) => new Set([...current, tabId]));
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.hash = `workspace-${tabId}`;
      window.history.replaceState(null, "", url);
    }
  }

  function handleKeyDown(event, index) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const lastIndex = availableTabs.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowRight"
          ? (index + 1) % availableTabs.length
          : (index - 1 + availableTabs.length) % availableTabs.length;
    selectTab(availableTabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  if (!availableTabs.length) return null;

  return (
    <section className={styles.shell} aria-label={label}>
      <div className={styles.heading}>
        <strong>{label}</strong>
        {intro ? <span>{intro}</span> : null}
      </div>
      <div ref={tabListRef} className={styles.tabList} role="tablist" aria-label={label}>
        {availableTabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              id={`${instanceId}-${tab.id}-tab`}
              className={selected ? styles.activeTab : styles.tab}
              role="tab"
              aria-selected={selected}
              aria-controls={`${instanceId}-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              {tab.description ? <small>{tab.description}</small> : null}
            </button>
          );
        })}
      </div>
      {availableTabs.map((tab, index) => visited.has(tab.id) ? (
        <div
          key={tab.id}
          id={`${instanceId}-${tab.id}-panel`}
          className={styles.panel}
          role="tabpanel"
          aria-labelledby={`${instanceId}-${tab.id}-tab`}
          hidden={activeId !== tab.id}
        >
          {panels[index]}
        </div>
      ) : null)}
    </section>
  );
}
