import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import SchoolStudentWorkspace from "./SchoolStudentWorkspace";

export default async function SchoolStudentPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/dashboard");
  return <SchoolStudentWorkspace />;
}
