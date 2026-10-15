import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { isPrivatePreviewAdminSession, isPrivatePreviewOwnerBootstrapSession, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { listPreviewTesters } from "@/lib/private-preview-accounts.mjs";
import { prisma } from "@/lib/prisma";
import CodeControls from "./CodeControls";
import PasswordControls from "./PasswordControls";
import TesterControls from "./TesterControls";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private preview access | Ruvanas",
  robots: { index: false, follow: false }
};

export default async function PrivatePreviewAdminPage() {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled || !policy.valid) notFound();
  const session = await getCurrentSession();
  const bootstrap = isPrivatePreviewOwnerBootstrapSession(session, policy);
  if (!bootstrap && !isPrivatePreviewAdminSession(session, policy)) notFound();
  const testers = bootstrap ? [] : await listPreviewTesters(prisma, { actorUserId: session.userId, policy });

  return (
    <section style={{ maxWidth: 720, margin: "0 auto", lineHeight: 1.5 }}>
      <p style={{ color: "#f4b942", fontWeight: 700, letterSpacing: "0.1em" }}>OWNER ACCESS CONTROL</p>
      <h1>Private access & tester accounts</h1>
      <p>Admin accounts sign in with email and password. Registration stays closed; only you can create tester accounts and select their pillars. No email is sent automatically.</p>
      <PasswordControls bootstrap={bootstrap} email={session.user.email} />
      {!bootstrap ? <>
        <TesterControls initialTesters={JSON.parse(JSON.stringify(testers))} />
        <h2>Temporary tester codes</h2>
        <p>After creating a tester, issue a one-use code below. Codes last 24 hours and cannot sign in to an admin account. Disabling a tester above revokes both password and code sessions.</p>
        <CodeControls />
      </> : <p>First save your password here. This replaces code-based admin access and unlocks tester management.</p>}
    </section>
  );
}
