import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/requireAdmin";

const navItems = [
  {
    href: "/admin/location-groups",
    label: "Location groups"
  },
  {
    href: "/admin/locations",
    label: "Retail locations"
  },
  {
    href: "/admin/channels",
    label: "Ruvanas Channels"
  },
  {
    href: "/admin/music-modes",
    label: "Music modes",
    superAdminOnly: true
  },
  {
    href: "/admin/music-schedules",
    label: "Music schedules",
    superAdminOnly: true
  },
  {
    href: "/admin/players",
    label: "Players & health"
  },
  {
    href: "/admin/proof-of-play",
    label: "Proof of play"
  },
  {
    href: "/admin/stations",
    label: "Stations"
  },
  {
    href: "/admin/media",
    label: "Promo Library"
  },
  {
    href: "/admin/campaigns",
    label: "Campaigns",
    superAdminOnly: true
  },
  {
    href: "/admin/catalogue",
    label: "Music Catalogue",
    superAdminOnly: true
  },
  {
    href: "/admin/brands",
    label: "Brands"
  },
  {
    href: "/admin/organisations",
    label: "Organisations"
  },
  {
    href: "/admin/billing",
    label: "Billing & usage",
    superAdminOnly: true
  },
  {
    href: "/admin/security",
    label: "Identity & security",
    superAdminOnly: true
  },
  {
    href: "/admin/compliance",
    label: "Compliance & support"
  }
];

export default async function AdminLayout({ children }) {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    redirect("/login");
  }

  const visibleNavItems = navItems.filter(
    (item) => !item.superAdminOnly || adminUser.role === "SUPER_ADMIN"
  );

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <header
        style={{
          borderBottom: "1px solid #cbd5e1",
          background: "#ffffff"
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap"
          }}
        >
          <div>
            <strong style={{ color: "#111827", fontSize: 16 }}>
              Ruvanas Admin
            </strong>

            <span
              style={{
                marginLeft: 12,
                color: "#475569",
                fontSize: 14,
                fontWeight: 600
              }}
            >
              Signed in as {adminUser.name || adminUser.email} (
              {adminUser.role})
            </span>
          </div>
        </div>

        <nav
          aria-label="Admin navigation"
          style={{
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc"
          }}
        >
          <div
            style={{
              maxWidth: 1180,
              margin: "0 auto",
              padding: "10px 24px",
              display: "flex",
              gap: 10,
              flexWrap: "wrap"
            }}
          >
            {visibleNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "inline-block",
                  padding: "8px 11px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 7,
                  background: "#ffffff",
                  color: "#1e293b",
                  fontSize: 14,
                  fontWeight: 800,
                  textDecoration: "none"
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <main>{children}</main>
    </div>
  );
}

