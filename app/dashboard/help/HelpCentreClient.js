"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import SkipLink from "@/app/components/SkipLink";
import { searchSubscriberHelp } from "@/lib/subscriber-help-centre.mjs";
import styles from "./help-centre.module.css";

export default function HelpCentreClient({ organisationName, help }) {
  const [query, setQuery] = useState("");
  const articles = useMemo(() => searchSubscriberHelp(query, help.articles), [query, help.articles]);

  return (
    <main className={styles.page}>
      <SkipLink />
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <Link href="/dashboard" className={styles.back}>Back to your home</Link>
      </header>
      <section className={styles.content} id="main-content">
        <p className={styles.eyebrow}>HELP CENTRE</p>
        <h1>How can we help?</h1>
        <p className={styles.subtitle}>Plain-language guidance for {organisationName}. Your account role is <strong>{help.roleLabel}</strong>.</p>

        <aside className={styles.roleGuidance} aria-label="Guidance for your account role">
          <strong>{help.canManage ? "Owner and manager guidance" : "View-only guidance"}</strong>
          <span>{help.guidance}</span>
        </aside>

        <label className={styles.search}>
          <span>Search help</span>
          <input
            type="search"
            value={query}
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try player, schedule, upload or offline"
          />
        </label>
        <p className={styles.resultCount} aria-live="polite">
          {articles.length} {articles.length === 1 ? "help article" : "help articles"}{query.trim() ? " found" : " available"}
        </p>

        {articles.length ? <div className={styles.articleList}>{articles.map((article) => (
          <article key={article.id} id={article.id} className={styles.article}>
            <p className={styles.category}>{article.category}</p>
            <h2>{article.title}</h2>
            <p>{article.summary}</p>
            <details open={query.trim() ? true : undefined}>
              <summary>Show steps</summary>
              <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </details>
          </article>
        ))}</div> : <section className={styles.noResults} role="status">
          <h2>No matching help article</h2>
          <p>Try a shorter term such as “player”, “music”, “upload” or “offline”.</p>
          <button type="button" onClick={() => setQuery("")}>Clear search</button>
        </section>}
      </section>
    </main>
  );
}
