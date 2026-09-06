"use client";

import { useEffect, useState } from "react";
import styles from "./station-website.module.css";

export default function NowPlaying({ slug, stationName, accent }) {
  const [result, setResult] = useState(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      try {
        const response = await fetch(`/api/public/station-websites/${encodeURIComponent(slug)}/now-playing`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (active) { setResult(body); setAvailable(true); }
      } catch {
        if (active) setAvailable(false);
      } finally {
        if (active) timer = window.setTimeout(refresh, 15_000);
      }
    }
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [slug]);

  const item = result?.nowPlaying;
  return <section className={styles.liveCard} aria-live="polite" style={{ "--station-accent": accent }}>
    <div className={styles.liveLabel}><span /> {available ? "LIVE NOW" : "STATION UPDATE"}</div>
    <p className={styles.track}>{item?.title || (available ? stationName : "Live information will return shortly")}</p>
    <p className={styles.artist}>{item?.artist || result?.channel || "Listen to hear what is playing"}</p>
  </section>;
}
