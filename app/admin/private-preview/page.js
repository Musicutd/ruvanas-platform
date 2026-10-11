import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { isPrivatePreviewAdmin, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import CodeControls from "./CodeControls";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private preview access | Ruvanas",
  robots: { index: false, follow: false }
};

export default async function PrivatePreviewAdminPage() {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled || !policy.valid) notFound();
  const session = await getCurrentSession();
  if (session?.authMethod !== "PREVIEW_CODE" || !isPrivatePreviewAdmin(session.user, policy)) notFound();

  return (
    <section style={{ maxWidth: 720, margin: "0 auto", lineHeight: 1.5 }}>
      <p style={{ color: "#f4b942", fontWeight: 700, letterSpacing: "0.1em" }}>OWNER ACCESS CONTROL</p>
      <h1>Private app preview codes</h1>
      <p>Issue a single-use code for an existing account on the private-preview allowlist, or revoke its pending codes and code-based sessions. A new code expires after 24 hours. No account is created and no email is sent.</p>
      <CodeControls />
    </section>
  );
}
