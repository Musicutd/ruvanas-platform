"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./product-qa.module.css";

const PRODUCT_LABELS = {
  RETAIL: "Retail Radio",
  SCHOOL: "School Radio",
  ONLINE: "Online Radio",
  HEALTH: "Ruvanas Health",
  FAITH: "Ruvanas Faith",
  ORGANISATIONS: "Ruvanas Organisations"
};

export default function ProductQaControlCentre({ initialProfiles }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function switchTier(profile, tier) {
    if (!profile.organisation || busy) return;
    const key = `${profile.product}:${tier.planCode}`;
    setBusy(key);
    setNotice("");
    try {
      const response = await fetch("/api/admin/product-qa", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: profile.organisation.id,
          planCode: tier.planCode
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to switch the QA tier.");

      setProfiles((current) => current.map((item) => item.product === profile.product
        ? {
            ...item,
            organisation: {
              ...item.organisation,
              plan: body.plan,
              acceptancePassed: body.acceptance.passed
            }
          }
        : item));
      setNotice(`${PRODUCT_LABELS[profile.product]} is now on Tier ${body.plan.tierNumber} — ${body.plan.name}. No billing event was created.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>CONTROLLED ACCEPTANCE</p>
          <h1>Product QA control centre</h1>
          <p>Exercise all six Ruvanas products through every public tier without creating a billing event or weakening product isolation.</p>
        </div>
        <div className={styles.boundary}>
          <strong>Super Admin only</strong>
          <span>Only the six named QA organisations with a non-billed trial subscription can be changed here.</span>
        </div>
      </header>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section className={styles.summary} aria-label="QA readiness summary">
        <div><strong>{profiles.filter((item) => item.organisation).length} / 6</strong><span>QA organisations found</span></div>
        <div><strong>{profiles.filter((item) => item.organisation?.acceptancePassed).length} / 6</strong><span>Current plans verified</span></div>
        <div><strong>30</strong><span>Tier combinations covered</span></div>
        <div><strong>0</strong><span>Billing events permitted</span></div>
      </section>

      <section className={styles.grid} aria-label="Product QA organisations">
        {profiles.map((profile) => {
          const organisation = profile.organisation;
          const safe = organisation && organisation.subscriptionStatus === "TRIAL" && !organisation.billingAttached && !organisation.complimentaryAccessActive;
          return (
            <article className={styles.card} key={profile.product}>
              <div className={styles.cardHeader}>
                <div><span>{profile.product}</span><h2>{PRODUCT_LABELS[profile.product]}</h2></div>
                <b data-tone={organisation?.acceptancePassed ? "ready" : "attention"}>
                  {organisation?.acceptancePassed ? "Verified" : organisation ? "Check setup" : "Not created"}
                </b>
              </div>

              {!organisation ? (
                <div className={styles.empty}>
                  <strong>Create “{profile.organisationName}”</strong>
                  <p>Use a controlled Ruvanas email alias and select the Tier 3 plan. Keep the password outside source control.</p>
                  <Link href={`/register?product=${profile.product.toLowerCase()}&tier=${profile.startingPlanCode.toLowerCase().replaceAll("_", "-")}`}>Open secure registration</Link>
                </div>
              ) : (
                <>
                  <dl className={styles.facts}>
                    <div><dt>Organisation</dt><dd>{organisation.name}</dd></div>
                    <div><dt>Current plan</dt><dd>{organisation.plan?.name || "No plan"}</dd></div>
                    <div><dt>Account</dt><dd>{organisation.ownerConfigured ? "Owner configured" : "Review membership"}</dd></div>
                    <div><dt>Billing boundary</dt><dd>{safe ? "Internal QA — no billing" : "Switching locked"}</dd></div>
                  </dl>
                  <div className={styles.tiers} aria-label={`${PRODUCT_LABELS[profile.product]} tiers`}>
                    {profile.tiers.map((tier) => {
                      const active = organisation.plan?.code === tier.planCode;
                      const key = `${profile.product}:${tier.planCode}`;
                      return (
                        <button
                          key={tier.planCode}
                          type="button"
                          disabled={!safe || active || Boolean(busy)}
                          data-active={active}
                          onClick={() => switchTier(profile, tier)}
                        >
                          <span>Tier {tier.tierNumber}</span>
                          <strong>{tier.planName}</strong>
                          <small>Catalogue: {tier.licensedMusicCatalogueLevel.toLowerCase()}</small>
                          <em>{active ? "Current" : busy === key ? "Switching…" : "Activate"}</em>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </section>

      <footer className={styles.footer}>
        <div><strong>Acceptance discipline</strong><span>After each switch, sign in as the QA account, confirm the recommended dashboard and ensure the other five product dashboards remain blocked.</span></div>
        <Link href="/admin/organisations">Review all organisations</Link>
      </footer>
    </div>
  );
}
