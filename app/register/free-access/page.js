import FreeAccessRegistration from "./FreeAccessRegistration";
import { notFound } from "next/navigation";
import { isInsideDemoEnvironment } from "@/lib/inside-demo-environment.mjs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create a free Ruvanas account",
  description: "Use a Super Admin-issued code to create an eligible complimentary Ruvanas account."
};

export default function FreeAccessRegistrationPage() {
  if (isInsideDemoEnvironment()) notFound();

  return <FreeAccessRegistration />;
}
