import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";

export default async function AdminLayout({ children }) {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/login");
  }

  return (
    <div>
      <header style={{ padding: "16px 24px", borderBottom: "1px solid #333" }}>
        <strong>Ruvanas Admin</strong>
        <span style={{ marginLeft: 12, opacity: 0.7 }}>
          Signed in as {adminUser.name || adminUser.email} ({adminUser.role})
        </span>
      </header>
      <main>{children}</main>
    </div>
  );
}
