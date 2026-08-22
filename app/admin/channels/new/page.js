import Link from "next/link";
import { prisma } from "@/lib/prisma";
import NewChannelForm from "./NewChannelForm";

export default async function NewAdminChannelPage() {
  const organisations = await prisma.organisation.findMany({
    include: {
      brands: {
        orderBy: {
          name: "asc"
        }
      },
      stations: {
        orderBy: {
          name: "asc"
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          streamConfig: {
            select: {
              streamUrl: true
            }
          }
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
        href="/admin/channels"
        style={{
          display: "inline-block",
          marginBottom: 20,
          color: "#f4b942",
          textDecoration: "none",
          fontWeight: 700
        }}
      >
        ← Back to Ruvanas Channels
      </Link>

      <h1 style={{ marginBottom: 8 }}>Add Ruvanas Channel</h1>

      <p style={{ marginTop: 0, marginBottom: 28, opacity: 0.7 }}>
        Create the friendly audio channel that will be assigned to one or more
        retail zones. You may optionally link it to an existing technical
        station and stream.
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
            Create an organisation and a retail location before adding a
            channel.
          </p>
        </div>
      ) : (
        <NewChannelForm organisations={organisations} />
      )}
    </div>
  );
}
