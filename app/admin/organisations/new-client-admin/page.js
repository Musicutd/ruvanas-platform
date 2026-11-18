import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authorizeOrdinaryOwnerCreation } from "@/lib/ordinary-owner-server";
import CreateClientAdminForm from "./CreateClientAdminForm";
import styles from "./client-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create Client Admin | Ruvanas" };

export default async function NewClientAdminPage() {
  const access = await authorizeOrdinaryOwnerCreation();
  if (!access.ok) redirect("/admin/organisations");
  const plans = await prisma.plan.findMany({
    where: { active: true, publiclyAvailable: true, productFamily: "RETAIL", retailRadioEnabled: true },
    orderBy: [{ tierNumber: "asc" }, { name: "asc" }],
    select: { id: true, name: true }
  });
  return <main className={styles.page}>
    <Link href="/admin/organisations">← Back to organisations</Link>
    <h1>Create workspace with Client Admin</h1>
    <p>The Client Admin manages this new Retail workspace. Use a different email for a shopper account.</p>
    <CreateClientAdminForm plans={plans} />
  </main>;
}
