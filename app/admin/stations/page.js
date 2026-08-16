import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminStationsPage() {
  const stations = await prisma.station.findMany({
    include: {
      organisation: true,
      streamConfig: true
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div style={{ padding: 24 }}>
      <h1>All Stations</h1>
      <p style={{ opacity: 0.7 }}>
        Configure Centova streaming details for any client station below.
      </p>

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #444" }}>
            <th style={{ padding: 8 }}>Station</th>
            <th style={{ padding: 8 }}>Organisation</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Streaming</th>
            <th style={{ padding: 8 }}>Created</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {stations.map((station) => (
            <tr key={station.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
              <td style={{ padding: 8 }}>{station.name}</td>
              <td style={{ padding: 8 }}>{station.organisation?.name}</td>
              <td style={{ padding: 8 }}>{station.status}</td>
              <td style={{ padding: 8 }}>
                {station.streamConfig ? "Configured" : "Not configured"}
              </td>
              <td style={{ padding: 8 }}>
                {new Date(station.createdAt).toLocaleDateString()}
              </td>
              <td style={{ padding: 8 }}>
                <Link href={`/admin/stations/${station.id}/setup`}>
                  Configure streaming
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {stations.length === 0 && <p>No stations yet.</p>}
    </div>
  );
}
