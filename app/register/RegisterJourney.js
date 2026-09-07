"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./register.module.css";

const STEPS = ["Service", "Plan", "Details", "Review"];

function ProductIcon({ product }) {
  if (product === "SCHOOL") return <span aria-hidden="true">S</span>;
  if (product === "ONLINE") return <span aria-hidden="true">O</span>;
  return <span aria-hidden="true">R</span>;
}

export default function RegisterJourney({ products, initialSelection }) {
  const router = useRouter();
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  const [step, setStep] = useState(initialSelection.selectedFromPricing ? 2 : 1);
  const [product, setProduct] = useState(initialSelection.product || "");
  const [tier, setTier] = useState(initialSelection.tier || "");
  const [selectedFromPricing, setSelectedFromPricing] = useState(initialSelection.selectedFromPricing);
  const [form, setForm] = useState({ name: "", organisationName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedProduct = useMemo(() => products.find((item) => item.id === product) || null, [product, products]);
  const selectedPlan = useMemo(() => selectedProduct?.plans.find((item) => item.publicSlug === tier) || null, [selectedProduct, tier]);

  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function selectProduct(value) {
    if (value !== product) setTier("");
    setProduct(value);
    setSelectedFromPricing(false);
    setError("");
  }

  function selectTier(value) {
    setTier(value);
    setSelectedFromPricing(false);
    setError("");
  }

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function nextStep() {
    setError("");
    if (step === 1 && !selectedProduct) return setError("Choose the Ruvanas service you want to run.");
    if (step === 2 && !selectedPlan) return setError("Choose an available plan to continue.");
    if (step === 3) {
      if (!form.name.trim() || !form.organisationName.trim() || !form.email.trim() || !form.password) return setError("Complete all account and organisation details.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError("Enter a valid email address.");
      if (form.password.length < 8) return setError("Your password must contain at least 8 characters.");
    }
    setStep((current) => Math.min(4, current + 1));
  }

  function previousStep() {
    setError("");
    setStep((current) => Math.max(1, current - 1));
  }

  async function createAccount() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, product, tier, source: selectedFromPricing ? "PRICING_PAGE" : "DIRECT" })
      });
      const data = await response.json();
      if (!response.ok) return setError(data.error || "Unable to create your account.");
      router.push(data.recommendedDashboardRoute || "/dashboard");
      router.refresh();
    } catch {
      setError("A connection error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#registration-content">Skip to registration</a>
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label="Ruvanas home"><span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span><span>RUVANAS</span><small>Part of 21-Three</small></a>
        <p>Already have an account? <a href="/login">Log in</a></p>
      </header>

      <section className={styles.shell} id="registration-content">
        <aside className={styles.intro}>
          <p className={styles.eyebrow}>START YOUR PLATFORM</p>
          <h1>Choose what you want to run with Ruvanas.</h1>
          <p>Set up the right workspace for your organisation. Your service and plan determine the tools you receive.</p>
          <div className={styles.promiseList}>
            <span><strong>One secure account</strong> for your organisation and team</span>
            <span><strong>Product-aware setup</strong> for Retail, School or Online Radio</span>
            <span><strong>Clear plan authority</strong> with no hidden product access</span>
          </div>
        </aside>

        <div className={styles.card}>
          <ol className={styles.progress} aria-label="Registration progress">
            {STEPS.map((label, index) => {
              const number = index + 1;
              return <li key={label} className={number === step ? styles.currentStep : number < step ? styles.completedStep : ""} aria-current={number === step ? "step" : undefined}><span>{number < step ? "✓" : number}</span><small>{label}</small></li>;
            })}
          </ol>

          {initialSelection.enterpriseRequested ? <p className={styles.enterpriseNotice} role="status">Enterprise services need a tailored setup. Choose a service to review its plans; Ruvanas will confirm Enterprise access directly with your organisation.</p> : null}
          {error ? <p className={styles.error} role="alert" tabIndex="-1" ref={errorRef}>{error}</p> : null}

          {step === 1 ? (
            <div className={styles.stepPanel}>
              <p className={styles.stepLabel}>Step 1 of 4</p><h2 tabIndex="-1" ref={headingRef}>Choose your service</h2><p className={styles.stepIntro}>Select the main platform this organisation will use.</p>
              <fieldset className={styles.optionGrid}><legend className={styles.srOnly}>Ruvanas service</legend>
                {products.map((item) => <label className={`${styles.productOption} ${product === item.id ? styles.selectedOption : ""}`} key={item.id}><input type="radio" name="product" value={item.id} checked={product === item.id} onChange={() => selectProduct(item.id)} /><span className={styles.productIcon}><ProductIcon product={item.id} /></span><span className={styles.optionCopy}><strong>{item.label}</strong><small>{item.description}</small></span><span className={styles.selectionText}>{product === item.id ? "Selected" : "Choose"}</span></label>)}
              </fieldset>
            </div>
          ) : null}

          {step === 2 ? (
            <div className={styles.stepPanel}>
              <p className={styles.stepLabel}>Step 2 of 4</p><h2 tabIndex="-1" ref={headingRef}>Choose your {selectedProduct?.shortLabel} plan</h2><p className={styles.stepIntro}>Every plan below is verified for {selectedProduct?.label}. You can change it before creating your account.</p>
              {selectedFromPricing ? <p className={styles.pricingBadge}>✓ Selected from pricing</p> : null}
              <fieldset className={styles.planGrid}><legend className={styles.srOnly}>Available plans</legend>
                {selectedProduct?.plans.map((plan) => plan.enterpriseContactRequired ? <div className={styles.enterprisePlan} key={plan.code}><div><span>Tier {plan.tierNumber}</span><strong>{plan.name}</strong><small>{plan.priceLabel}</small></div><p>{plan.description}</p><span className={styles.contactRequired}>Tailored setup required</span></div> : <label className={`${styles.planOption} ${tier === plan.publicSlug ? styles.selectedOption : ""}`} key={plan.code}><input type="radio" name="tier" value={plan.publicSlug} checked={tier === plan.publicSlug} onChange={() => selectTier(plan.publicSlug)} /><span className={styles.planTop}><span>Tier {plan.tierNumber}</span><strong>{plan.name}</strong><small>{plan.priceLabel}</small></span><span className={styles.planDescription}>{plan.description}</span><span className={styles.planFacts}>{plan.storageLimitGb} GB storage · up to {plan.maxBitrateKbps} kbps</span><span className={styles.catalogueNote}>{plan.catalogueDescription}</span><span className={styles.selectionText}>{tier === plan.publicSlug ? "Selected" : "Choose plan"}</span></label>)}
              </fieldset>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={styles.stepPanel}>
              <p className={styles.stepLabel}>Step 3 of 4</p><h2 tabIndex="-1" ref={headingRef}>Tell us about the account owner</h2><p className={styles.stepIntro}>These details create the organisation owner account. You can return to earlier steps without losing them.</p>
              <div className={styles.formGrid}>
                <label>Your name<input type="text" name="name" value={form.name} onChange={updateField} autoComplete="name" maxLength="120" required /></label>
                <label>Organisation name<input type="text" name="organisationName" value={form.organisationName} onChange={updateField} autoComplete="organization" maxLength="160" required /></label>
                <label>Email address<input type="email" name="email" value={form.email} onChange={updateField} autoComplete="email" maxLength="320" required /></label>
                <label>Password<input type="password" name="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="8" maxLength="200" aria-describedby="password-help" required /><small id="password-help">Use at least 8 characters.</small></label>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className={styles.stepPanel}>
              <p className={styles.stepLabel}>Step 4 of 4</p><h2 tabIndex="-1" ref={headingRef}>Review your Ruvanas setup</h2><p className={styles.stepIntro}>Confirm the service and plan selected for this organisation.</p>
              <dl className={styles.reviewList}>
                <div><dt>Service</dt><dd>{selectedProduct?.label}</dd></div><div><dt>Plan</dt><dd>{selectedPlan?.name}<small>{selectedPlan?.priceLabel}</small></dd></div><div><dt>Organisation</dt><dd>{form.organisationName}</dd></div><div><dt>Account owner</dt><dd>{form.name}<small>{form.email}</small></dd></div><div><dt>Starting state</dt><dd>30-day trial<small>Controlled by Ruvanas server-side</small></dd></div>
              </dl>
              <p className={styles.rightsNotice}><strong>Music availability:</strong> {selectedPlan?.catalogueDescription} Availability is always subject to territory and permitted product use.</p>
            </div>
          ) : null}

          <div className={styles.actions}>{step > 1 ? <button type="button" className={styles.backButton} onClick={previousStep} disabled={loading}>Back</button> : <span />}{step < 4 ? <button type="button" className={styles.nextButton} onClick={nextStep}>Continue</button> : <button type="button" className={styles.nextButton} onClick={createAccount} disabled={loading}>{loading ? "Creating account…" : "Create account"}</button>}</div>
        </div>
      </section>
    </main>
  );
}
