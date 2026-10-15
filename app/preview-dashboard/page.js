import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { readPrivatePreviewPolicy, isPrivatePreviewTester } from "@/lib/private-preview-policy.mjs";
import { SUBSCRIBER_PRODUCT_LIST } from "@/lib/product-access.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your tester access | Ruvanas", robots: { index: false, follow: false } };
export default async function PreviewDashboard() {
  const session = await getCurrentSession();
  if (!isPrivatePreviewTester(session?.user, readPrivatePreviewPolicy())) notFound();
  const access = session.user.privatePreviewAccess;
  return <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px", color: "#172033" }}>
    <p style={{ color: "#9a6400", fontWeight: 800 }}>RUVANAS · PRIVATE TESTER PREVIEW</p>
    <h1>Welcome, {session.user.name || session.user.email}</h1>
    <p>Your administrator has given you read-only access to the pillars below, in your own separate sandbox. Public publishing, downloads, account creation and paid actions are unavailable.</p>
    <p>Access expires {access.expiresAt.toLocaleDateString("en-GB", { timeZone: "Europe/Malta" })}. Contact the administrator to change your access.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 20, margin: "28px 0" }}>
      {SUBSCRIBER_PRODUCT_LIST.filter(({ key }) => access.pillars.includes(key)).map((product) =>
        <section key={product.key} style={{ border: "1px solid #a9b7c9", padding: 24, borderRadius: 12 }}>
          <h2>{product.label}</h2><p>{product.description}</p><Link href={product.href}>Open pillar</Link>
        </section>)}
    </div>
    <form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form>
  </main>;
}
