import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";
import { subscriberTestResetAvailable } from "@/lib/subscriber-test-reset-availability.mjs";
import TestDataReset from "./TestDataReset";

export const metadata = { title: "Subscriber test-data reset" };

export default async function TestDataResetPage() {
  const user = await getAdminUser();
  if (user?.role !== "SUPER_ADMIN" || !subscriberTestResetAvailable()) redirect("/admin/organisations");
  return <TestDataReset retainedEmail={user.email} />;
}
