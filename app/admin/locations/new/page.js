import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewLocationForm from "./NewLocationForm";

export default async function NewAdminLocationPage() {
  const organisations = await prisma.organisation.findMany({
    include: {
      brands: {
        orderBy: {
          name: "asc"
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
      <Link
        href="/admin/locations"
        style={{
          display: "inline-block",
          marginBottom: 20,
          color: "#f4b942",
          textDecoration: "none",
          fontWeight: 700
        }}
      >
        ← Back to retail locations
      </Link>

      <h1 style={{ marginBottom: 8 }}>Add retail location</h1>

      <p style={{ marginTop: 0, marginBottom: 28, opacity: 0.7 }}>
        Create a physical store, venue, branch, office, restaurant, hotel, or
        other location where Ruvanas in-store audio will be delivered.
      </p>

      {organisations.length === 0 ? (
        <div
          style={{
            padding: 20,
            border: "1px solid #8a3b3b",
            borderRadius: 10,
            background: "#2a1717"
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 800 }}>
            No organisation is available.
          </p>

          <p style={{ marginBottom: 0, opacity: 0.8 }}>
            Create an organisation before adding a retail location.
          </p>
        </div>
      ) : (
        <NewLocationForm organisations={organisations} />
      )}
    </div>
  );
}
