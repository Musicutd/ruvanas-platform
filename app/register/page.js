import RegisterJourney from "./RegisterJourney";
import {
  registrationProducts,
  resolveRegistrationDeepLink
} from "@/lib/registration-experience.mjs";

export const metadata = {
  title: "Create your account",
  description: "Choose your Ruvanas service and plan, then create your organisation account."
};

export default async function RegisterPage({ searchParams }) {
  const query = await Promise.resolve(searchParams);
  const initialSelection = resolveRegistrationDeepLink({
    platform: query?.platform,
    tier: query?.tier
  });

  return <RegisterJourney products={registrationProducts()} initialSelection={initialSelection} />;
}
