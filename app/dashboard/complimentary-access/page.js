import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ComplimentaryAccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(user.role === "SUPER_ADMIN" ? "/admin/complimentary-access" : "/dashboard/account");
}
