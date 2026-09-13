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

export default function HowItWorksClient({ organisationName, membershipRole, publicView = false, visibleProductIds = [] }) {
  const visibleGuides = publicView
    ? ruvanasProductGuides
    : ruvanasProductGuides.filter((product) => visibleProductIds.includes(product.id));
  const guides = visibleGuides.length ? visibleGuides : ruvanasProductGuides.slice(0, 1);
  const singleGuide = !publicView && guides.length === 1 ? guides[0] : null;

  return (
    <main className={styles.page} id="main-content">
      <SkipLink />
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{singleGuide ? `${singleGuide.eyebrow} · YOUR GUIDE` : "ONE GUIDE · SIX PRODUCTS"}</p>
          <h1>{singleGuide ? `How ${singleGuide.tabLabel} works` : "How Ruvanas works"}</h1>
          <p>{singleGuide ? `This page shows only the ${singleGuide.tabLabel} guidance included with your current organisation service.` : "Choose a product, then open only the information you need. This guide explains the complete journey from account setup to content, programming, delivery and evidence."}</p>
        </div>
        <aside className={styles.contextCard}>
          <span>{publicView ? "EXPLORE BEFORE REGISTERING" : "YOU ARE VIEWING"}</span>
          <strong>{publicView ? "No account needed" : organisationName}</strong>
          <small>{publicView ? "See how each Ruvanas product works" : `${String(membershipRole || "member").replaceAll("_", " ").toLowerCase()} access`}</small>
        </aside>
      </header>

      <section className={styles.startHere} aria-label="How to use this page">
        <strong>Start here</strong>
        <span>{singleGuide ? `1. Review the ${singleGuide.tabLabel} journey for your active service.` : "1. Choose Retail, School, Radio, Health, Faith or Organisations."}</span>
        <span>2. Click a titled box to see the explanation.</span>
        <span>3. Use the links inside each box to open the correct workspace.</span>
      </section>

      <WorkspaceTabs
        label="Choose your Ruvanas product"
        intro={singleGuide ? `Only ${singleGuide.tabLabel} is shown for this organisation.` : "All six guides stay together on this page."}
        defaultTab={guides[0].id}
        tabs={guides.map((product) => ({ id: product.id, label: product.tabLabel, description: product.tabDescription }))}
      >
        {guides.map((product) => <ProductGuide key={product.id} product={product} publicView={publicView} />)}
      </WorkspaceTabs>

      <footer className={styles.footerHelp}>
        <div><strong>{publicView ? "Ready to choose your Ruvanas service?" : "Need help with a specific problem?"}</strong><span>{publicView ? "Create an account or sign in to continue with your organisation." : "Search short answers or send a secure request to the Ruvanas team."}</span></div>
        <nav aria-label="Additional help">
          {publicView ? <><Link href="/register/free-access">Use access code</Link><Link href="/login">Log in</Link></> : <><Link href="/dashboard/help">Help centre</Link><Link href="/dashboard/support">Support requests</Link></>}
        </nav>
      </footer>
    </main>
  );
}
