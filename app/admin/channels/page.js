import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ChannelStatusButton from "./ChannelStatusButton";

export default async function AdminChannelsPage() {
  const channels = await prisma.channel.findMany({
    include: {
      organisation: true,
      brand: true,
      station: {
        include: {
          streamConfig: true
        }
      },
      zoneAssignments: {
        include: {
          zone: {
            include: {
              location: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap"
        }}
      >
        <div>
          <h1 style={{ marginBottom: 8 }}>Ruvanas Channels</h1>
          <p style={{ margin: 0, opacity: 0.7 }}>
            Each active channel runs its own synchronized live programme clock.
            Premium plans can run several channels simultaneously; a linked
            technical stream is an optional fallback.
          </p>
        </div>

        <Link
          href="/admin/channels/new"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 8,
            background: "#f4b942",
            color: "#101827",
            fontWeight: 800,
            textDecoration: "none"
          }}
        >
          Add channel
        </Link>
      </div>

      {channels.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            padding: 20,
            border: "1px solid #2a2a2a",
            borderRadius: 10
          }}
        >
          <p style={{ marginTop: 0, fontWeight: 700 }}>
            No Ruvanas channels yet.
          </p>

          <p style={{ marginBottom: 0, opacity: 0.7 }}>
            Create a channel such as “Fashion K Main Radio”, then assign it to
            the Main Store, Sales Floor, or any other audio zone.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 24 }}>
          <table
            style={{
              width: "100%",
              minWidth: 1120,
              borderCollapse: "collapse"
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #444"
                }}
              >
                <th style={{ padding: 8 }}>Channel</th>
                <th style={{ padding: 8 }}>Organisation</th>
                <th style={{ padding: 8 }}>Brand</th>
                <th style={{ padding: 8 }}>Technical station</th>
                <th style={{ padding: 8 }}>Stream</th>
                <th style={{ padding: 8 }}>Assigned zones</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}>Action</th>
              </tr>
            </thead>

            <tbody>
              {channels.map((channel) => {
                const streamConfigured = Boolean(
                  channel.station?.streamConfig?.streamUrl
                );

                const canActivate = channel.zoneAssignments.length > 0;

                return (
                  <tr
                    key={channel.id}
                    style={{ borderBottom: "1px solid #2a2a2a" }}
                  >
                    <td style={{ padding: 8 }}>
                      <div style={{ fontWeight: 700 }}>{channel.name}</div>

                      {channel.description ? (
                        <div style={{ fontSize: 13, opacity: 0.7 }}>
                          {channel.description}
                        </div>
                      ) : null}
                    </td>

                    <td style={{ padding: 8 }}>
                      {channel.organisation.name}
                    </td>

                    <td style={{ padding: 8 }}>
                      {channel.brand?.name ?? "—"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {channel.station?.name ?? "Not linked"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {streamConfigured
                        ? "Ruvanas live + external fallback"
                        : "Ruvanas synchronized live"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {channel.zoneAssignments.length}
                    </td>

                    <td style={{ padding: 8 }}>{channel.status}</td>

                    <td style={{ padding: 8 }}>
                      {new Date(channel.createdAt).toLocaleDateString()}
                    </td>

                    <td style={{ padding: 8 }}>
                      <ChannelStatusButton
                        channelId={channel.id}
                        channelName={channel.name}
                        currentStatus={channel.status}
                        canActivate={canActivate}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Link href="/admin/locations">← Back to retail locations</Link>
      </div>
    </div>
  );
}
