import TeamInvitationForm from "./TeamInvitationForm";
import { notFound } from "next/navigation";
import { isInsideDemoEnvironment } from "@/lib/inside-demo-environment.mjs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join your Ruvanas team" };

export default function TeamInvitationPage() {
  if (isInsideDemoEnvironment()) notFound();

  return <TeamInvitationForm />;
}
