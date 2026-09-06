"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./listener-requests.module.css";

const FILTERS = ["PENDING", "APPROVED", "PLAYED", "REJECTED", "ARCHIVED", "ALL"];

export default function ListenerRequestWorkspace({ stationId, canBlock }) {
  const [filter, setFilter] = useState("PENDING");
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    const query = filter === "ALL" ? "" : `?status=${filter}`;
    const response = await fetch(`/api/stations/${stationId}/listener-requests${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load listener requests.");
    setItems(body.requests || []);
  }, [filter, stationId]);

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);

  async function act(item, action, blockSession = false) {
    setBusy(`${item.id}:${action}`); setMessage("");
    try {
      const response = await fetch(`/api/stations/${stationId}/listener-requests/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note: notes[item.id] || "", blockSession }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the request.");
      setMessage(action === "UNBLOCK" ? "The listening session can submit requests again." : "Listener request updated.");
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  return <section className={styles.workspace}>
    <nav className={styles.filters} aria-label="Request status">{FILTERS.map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value.replace("_", " ")}</button>)}</nav>
    {message ? <p className={styles.notice} role="status">{message}</p> : null}
    {!items.length ? <div className={styles.empty}><strong>No {filter === "ALL" ? "" : filter.toLowerCase()} requests</strong><span>New moderated requests will appear here.</span></div> : <div className={styles.list}>{items.map((item) => <article className={styles.card} key={item.id}>
      <div className={styles.cardTop}><div><span className={styles.status}>{item.status}</span><h2>{item.artist} — {item.title}</h2><time>{new Date(item.createdAt).toLocaleString("en-MT")}</time></div>{item.blocked ? <span className={styles.blocked}>SESSION BLOCKED</span> : null}</div>
      {item.message ? <blockquote>{item.message}</blockquote> : null}
      {item.reviewNote ? <p className={styles.reviewNote}><strong>Review note:</strong> {item.reviewNote}</p> : null}
      {item.status === "PENDING" ? <label className={styles.note}>Moderation note<textarea maxLength={500} value={notes[item.id] || ""} onChange={(event) => setNotes((value) => ({ ...value, [item.id]: event.target.value }))} placeholder="Required when rejecting; optional when approving." /></label> : null}
      <div className={styles.actions}>
        {item.status === "PENDING" ? <><button disabled={Boolean(busy)} onClick={() => act(item, "APPROVE")}>Approve</button><button className={styles.secondary} disabled={Boolean(busy)} onClick={() => act(item, "REJECT")}>Reject</button>{canBlock ? <button className={styles.danger} disabled={Boolean(busy)} onClick={() => act(item, "REJECT", true)}>Reject & block session</button> : null}</> : null}
        {item.status === "APPROVED" ? <button disabled={Boolean(busy)} onClick={() => act(item, "MARK_PLAYED")}>Mark played</button> : null}
        {["REJECTED", "PLAYED"].includes(item.status) ? <button className={styles.secondary} disabled={Boolean(busy)} onClick={() => act(item, "ARCHIVE")}>Archive</button> : null}
        {canBlock && item.blocked ? <button className={styles.secondary} disabled={Boolean(busy)} onClick={() => act(item, "UNBLOCK")}>Unblock session</button> : null}
      </div>
    </article>)}</div>}
  </section>;
}
