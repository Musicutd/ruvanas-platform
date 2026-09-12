"use client";

import Link from "next/link";
import SkipLink from "@/app/components/SkipLink";
import WorkspaceTabs from "@/app/dashboard/WorkspaceTabs";
import { ruvanasProductGuides } from "@/lib/how-ruvanas-works.mjs";
import styles from "./how-it-works.module.css";

function ProductGuide({ product, publicView = false }) {
  return (
    <section className={styles.productGuide} aria-labelledby={`${product.id}-guide-title`}>
      <div className={styles.productIntro}>
        <div>
          <p className={styles.productEyebrow}>{product.eyebrow}</p>
          <h2 id={`${product.id}-guide-title`}>{product.title}</h2>
          <p>{product.introduction}</p>
        </div>
        <aside className={styles.outcome}>
          <span>THE RESULT</span>
          <strong>{product.outcome}</strong>
        </aside>
      </div>

      <div className={styles.guideActions}>
        <Link href={publicView ? "/register" : product.startHref} className={styles.primaryAction}>
          {publicView ? `Start with ${product.tabLabel}` : product.startLabel}
        </Link>
        <span>Open each box below for the detailed explanation and next actions.</span>
      </div>

      <div className={styles.chapterList}>
        {product.chapters.map((chapter) => (
          <details key={chapter.title} className={styles.chapter}>
            <summary>
              <span><strong>{chapter.title}</strong><small>{chapter.summary}</small></span>
              <b aria-hidden="true">+</b>
            </summary>
            <div className={styles.chapterBody}>
              <p>{chapter.detail}</p>
              <h3>What to do</h3>
              <ol>{chapter.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <nav aria-label={`${chapter.title} links`}>
                {chapter.links.map((link) => (
                  <Link key={link.href + link.label} href={link.href}>{link.label}<span aria-hidden="true">→</span></Link>
                ))}
              </nav>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function HowItWorksClient({ organisationName, membershipRole, publicView = false }) {
  return (
    <main className={styles.page} id="main-content">
      <SkipLink />
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>ONE GUIDE · FIVE PRODUCTS</p>
          <h1>How Ruvanas works</h1>
          <p>Choose a product, then open only the information you need. This guide explains the complete journey from account setup to content, programming, delivery and evidence.</p>
        </div>
        <aside className={styles.contextCard}>
          <span>{publicView ? "EXPLORE BEFORE REGISTERING" : "YOU ARE VIEWING"}</span>
          <strong>{publicView ? "No account needed" : organisationName}</strong>
          <small>{publicView ? "See how each Ruvanas product works" : `${String(membershipRole || "member").replaceAll("_", " ").toLowerCase()} access`}</small>
        </aside>
      </header>

      <section className={styles.startHere} aria-label="How to use this page">
        <strong>Start here</strong>
        <span>1. Choose Retail, School, Radio, Health or Faith.</span>
        <span>2. Click a titled box to see the explanation.</span>
        <span>3. Use the links inside each box to open the correct workspace.</span>
      </section>

      <WorkspaceTabs
        label="Choose your Ruvanas product"
        intro="All five guides stay together on this page."
        defaultTab="retail"
        tabs={ruvanasProductGuides.map((product) => ({ id: product.id, label: product.tabLabel, description: product.tabDescription }))}
      >
        {ruvanasProductGuides.map((product) => <ProductGuide key={product.id} product={product} publicView={publicView} />)}
      </WorkspaceTabs>

      <footer className={styles.footerHelp}>
        <div><strong>{publicView ? "Ready to choose your Ruvanas service?" : "Need help with a specific problem?"}</strong><span>{publicView ? "Create an account or sign in to continue with your organisation." : "Search short answers or send a secure request to the Ruvanas team."}</span></div>
        <nav aria-label="Additional help">
          {publicView ? <><Link href="/register">Create account</Link><Link href="/login">Log in</Link></> : <><Link href="/dashboard/help">Help centre</Link><Link href="/dashboard/support">Support requests</Link></>}
        </nav>
      </footer>
    </main>
  );
}
