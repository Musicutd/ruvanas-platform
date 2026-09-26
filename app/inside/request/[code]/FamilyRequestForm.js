"use client";

import { useState } from "react";
import styles from "./request.module.css";

export default function FamilyRequestForm({ code }) {
  const [type, setType] = useState("SONG");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setNotice("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/public/corrections/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries([...form.entries(), ["facilityCode", code], ["consent", form.has("consent")], ["type", type]])) });
      const result = await response.json();
      if (response.ok) { setNotice(result.message); formElement.reset(); }
      else setNotice(result.error || "Please try again later.");
    } catch { setNotice("The request could not be sent. Please try again later."); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}><section className={styles.card}>
    <span className={styles.brand}>RUVANAS INSIDE</span><h1>Send a radio request</h1>
    <p>A facility team reviews every request. Sending a request does not guarantee it will be played or delivered to a particular person. This is not a private messaging service.</p>
    <form onSubmit={submit} className={styles.form}>
      <label>Request type<select value={type} onChange={(event) => setType(event.target.value)}><option value="SONG">Song request</option><option value="DEDICATION">Dedication</option><option value="MESSAGE">Short programme message</option></select></label>
      <label>Recipient reference provided by the facility<input name="recipientReference" maxLength={80} required autoComplete="off" /></label>
      <label>Your display name<input name="senderDisplayName" maxLength={80} required /></label>
      <label>Relationship (optional)<input name="relationship" maxLength={60} /></label>
      {type === "SONG" && <><label>Song title<input name="songTitle" maxLength={160} required /></label><label>Artist (optional)<input name="songArtist" maxLength={160} /></label></>}
      <label>Short message {type === "SONG" ? "(optional)" : ""}<textarea name="message" maxLength={500} rows={4} required={type !== "SONG"} /></label>
      <label className={styles.consent}><input name="consent" type="checkbox" required /> I understand this is a moderated radio request, not a private message. The facility may decline or edit on-air wording.</label>
      <input name="website" className={styles.trap} tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <button disabled={busy}>{busy ? "Sending…" : "Send for review"}</button>
    </form>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <p className={styles.small}>Do not include medical, legal, offence, sentence, address or identification details. This form does not confirm that a person is at any facility.</p>
  </section></main>;
}
