import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authorizeDormantShopperCreation } from "@/lib/dormant-shopper-server";
import CreateDisabledShopperForm from "./CreateDisabledShopperForm";
import styles from "../../organisations/new-client-admin/client-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prepare a shopper | Ruvanas" };

export default async function NewShopperPage() {
  const access = await authorizeDormantShopperCreation();
  if (!access.ok) redirect("/admin/organisations");
  const [organisations, setups] = await Promise.all([
    prisma.organisation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.rewardShopperSetup.findMany({ take: 20, orderBy: [{ createdAt: "desc" }, { shopperId: "asc" }],
      select: { shopperId: true, emailCanonical: true, organisation: { select: { name: true } },
        shopper: { select: { displayName: true, status: true } } } })
  ]);
  return <main className={styles.page}>
    <Link href="/admin/organisations">← Back to organisations</Link>
    <h1>Prepare a shopper</h1>
    <p>Create a disabled shopper record before a Rewards rehearsal. The shopper cannot sign in or use coupons yet.</p>
    <CreateDisabledShopperForm organisations={organisations} />
    <section className={styles.panel} aria-labelledby="saved-shopper-setups">
      <h2 id="saved-shopper-setups">Recent shopper setups</h2>
      <p>Check here before retrying if a submission result was unclear. Showing the 20 most recent records.</p>
      {setups.length ? <ul>{setups.map(row => <li key={row.shopperId}>
        <strong>{row.shopper.displayName}</strong> · {row.emailCanonical}<br />
        Prepared for {row.organisation.name} · {row.shopper.status}
      </li>)}</ul> : <p>No disabled shopper records have been prepared.</p>}
    </section>
  </main>;
}
