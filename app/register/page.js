import RegisterJourney from "./RegisterJourney";
import {
  registrationProducts,
  resolveRegistrationDeepLink
} from "@/lib/registration-experience.mjs";
import {
  SELF_SERVICE_REGISTRATION_ENABLED,
  SELF_SERVICE_REGISTRATION_MESSAGE
} from "@/lib/registration-availability.mjs";
import styles from "./register.module.css";

export const metadata = {
  title: SELF_SERVICE_REGISTRATION_ENABLED ? "Create your account" : "Registration by code only",
  description: SELF_SERVICE_REGISTRATION_ENABLED
    ? "Choose your Ruvanas service and plan, then create your organisation account."
    : "Ruvanas public plan registration is temporarily paused. Eligible recipients can register with a Super Admin-issued code."
};

export default async function RegisterPage({ searchParams }) {
  if (!SELF_SERVICE_REGISTRATION_ENABLED) {
    return (
      <main className={styles.page}>
        <section className={styles.closedCard} aria-labelledby="registration-paused-title">
          <a className={styles.closedBrand} href="/">RUVANAS</a>
          <p className={styles.eyebrow}>REGISTRATION BY CODE ONLY</p>
          <h1 id="registration-paused-title">Plan registration is temporarily paused</h1>
          <p>{SELF_SERVICE_REGISTRATION_MESSAGE}</p>
          <div className={styles.closedActions}>
            <a className={styles.closedPrimary} href="/register/free-access">Create free account with code</a>
            <a className={styles.closedSecondary} href="/login">Log in to an existing account</a>
          </div>
          <small>All paid and trial tiers remain unavailable until the payment module is ready.</small>
        </section>
      </main>
    );
  }

  const query = await Promise.resolve(searchParams);
  const initialSelection = resolveRegistrationDeepLink({
    platform: query?.platform,
    tier: query?.tier
  });

  return <RegisterJourney products={registrationProducts()} initialSelection={initialSelection} />;
}
