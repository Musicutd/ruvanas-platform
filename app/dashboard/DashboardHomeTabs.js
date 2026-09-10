"use client";

import { Children, useEffect, useRef, useState } from "react";
import styles from "./dashboard-home-tabs.module.css";

const VIEWS = [
  { id: "today", label: "Today", description: "Next step and setup" },
  { id: "products", label: "Products", description: "Your Ruvanas services" },
  { id: "tools", label: "Tools & status", description: "Shortcuts and service details" }
];

function viewFromHash() {
  if (typeof window === "undefined") return "today";
  const requested = window.location.hash.replace("#dashboard-", "");
  return VIEWS.some((view) => view.id === requested) ? requested : "today";
}

export default function DashboardHomeTabs({ children }) {
  const panels = Children.toArray(children);
  const [activeView, setActiveView] = useState("today");
  const tabRefs = useRef([]);

  useEffect(() => {
    setActiveView(viewFromHash());
  }, []);

  function selectView(viewId, { updateAddress = true } = {}) {
    setActiveView(viewId);
    if (updateAddress) {
      window.history.replaceState(null, "", `#dashboard-${viewId}`);
    }
  }

  function handleTabKeyDown(event, index) {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEWS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEWS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    selectView(VIEWS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className={styles.workspace} aria-label="Dashboard views">
      <div className={styles.tabList} role="tablist" aria-label="Choose what to see">
        {VIEWS.map((view, index) => {
          const selected = activeView === view.id;
          return (
            <button
              key={view.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              id={`dashboard-${view.id}-tab`}
              aria-selected={selected}
              aria-controls={`dashboard-${view.id}-panel`}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => selectView(view.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{view.label}</span>
              <small>{view.description}</small>
            </button>
          );
        })}
      </div>

      {VIEWS.map((view, index) => (
        <div
          key={view.id}
          id={`dashboard-${view.id}-panel`}
          role="tabpanel"
          aria-labelledby={`dashboard-${view.id}-tab`}
          hidden={activeView !== view.id}
          className={styles.panel}
        >
          {panels[index] || null}
        </div>
      ))}
    </section>
  );
}
