"use client";

import { useEffect, useState } from "react";

export default function OfflineActions() {
  const [stationPath, setStationPath] = useState(null);
  useEffect(() => { setStationPath(window.localStorage.getItem("ruvanas_last_station_path")); }, []);
  return <div style={styles.actions}>
    <button type="button" style={styles.primary} onClick={() => window.location.reload()}>Try connection again</button>
    {stationPath ? <a style={styles.secondary} href={stationPath}>Open saved station page</a> : <a style={styles.secondary} href="/">Ruvanas home</a>}
  </div>;
}

const styles = { actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 28 }, primary: { border: 0, borderRadius: 10, padding: "13px 17px", background: "#f4b942", color: "#101827", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #52627a", borderRadius: 10, padding: "12px 17px", color: "#f8fafc", fontWeight: 850, textDecoration: "none" } };
