import StudentInvitationForm from "./StudentInvitationForm";
import { notFound } from "next/navigation";
import { isInsideDemoEnvironment } from "@/lib/inside-demo-environment.mjs";

export const dynamic = "force-dynamic";

export default function StudentInvitationPage() {
  if (isInsideDemoEnvironment()) notFound();

  return <StudentInvitationForm />;
}
