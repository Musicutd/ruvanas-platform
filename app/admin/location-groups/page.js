import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewLocationGroupForm from "./NewLocationGroupForm";

export default async function LocationGroupsPage() {
  const [groups, organisations] = await Promise.all([
    prisma.locationGroup.findMany({
      include: { organisation: true, _count: { select: { locations: true } } },
      orderBy: [{ organisation: { name: "asc" } }, { name: "asc" }]
    }),
    prisma.organisation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
  ]);

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Location groups</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>
        Group stores and venues for easier regional management and future bulk channel scheduling.
      </p>

      <section style={{ marginTop: 28, padding: 20, border: "1px solid #cbd5e1", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>Create a group</h2>
        <NewLocationGroupForm organisations={organisations} />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Existing groups</h2>
        {groups.length === 0 ? (
          <p style={{ color: "#475569" }}>No location groups yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {groups.map((group) => (
              <Link key={group.id} href={`/admin/location-groups/${group.id}`} style={{ padding: 16, border: "1px solid #cbd5e1", borderRadius: 9, color: "#111827", textDecoration: "none" }}>
                <strong>{group.name}</strong>
                <span style={{ marginLeft: 10, color: "#64748b" }}>{group.organisation.name} · {group._count.locations} location{group._count.locations === 1 ? "" : "s"}</span>
                {group.description ? <div style={{ marginTop: 6, color: "#475569" }}>{group.description}</div> : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

