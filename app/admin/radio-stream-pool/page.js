import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";
import RadioStreamPoolForm from "./RadioStreamPoolForm";

export default async function RadioStreamPoolPage() {
  const user = await getAdminUser();
  if (user?.role !== "SUPER_ADMIN") redirect("/admin/stations");

  return <main style={{ maxWidth: 1050, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" }}>
    <p style={{ margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, textTransform: "uppercase" }}>Radio control · Super Admin</p>
    <h1 style={{ margin: "0 0 12px", fontSize: 32 }}>Prepared stream pool</h1>
    <p style={{ maxWidth: 760, lineHeight: 1.6, color: "#475569" }}>
      Register a Centova account that has already been created outside Ruvanas. Registration stores its source password securely, but leaves the account quarantined. It cannot be assigned to a customer or start broadcasting until a separate verification step is complete.
    </p>
    <p><Link href="/admin/stations">← Back to stations</Link></p>
    <RadioStreamPoolForm />
  </main>;
}
