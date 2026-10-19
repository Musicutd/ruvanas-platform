"use client";

import { useEffect, useRef, useState } from "react";
import { SUBSCRIBER_PRODUCT_LIST } from "@/lib/product-access.mjs";
import { isPreviewOnlineDraftAccessMode } from "@/lib/private-preview-account-policy.mjs";

const endpoint = "/api/admin/private-preview/testers";
const EMPTY_TESTERS = Object.freeze([]);
const inputStyle = { display: "block", width: "100%", maxWidth: 440, marginTop: 6, padding: 10 };
const panelStyle = { border: "1px solid #42526b", borderRadius: 12, padding: 24, marginTop: 24 };
const passwordHelp = "Use at least 12 characters and no more than 72 UTF-8 bytes. Share credentials privately, never in public messages.";

function AccessModeChoice({ id, value, onChange, disabled }) {
  return <>
    <label htmlFor={`${id}-mode`} style={{ display: "block", marginTop: 20, fontWeight: 700 }}>Tester workspace access</label>
    <select id={`${id}-mode`} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} style={inputStyle}>
      <option value="READ_ONLY">Read-only — selected pillars</option>
      <option value="ONLINE_DRAFT">Editable Online Radio drafts only</option>
      <option value="ONLINE_DRAFT_CATALOGUE">Online Radio drafts + Malta catalogue (no audio)</option>
    </select>
    <p>{value === "ONLINE_DRAFT_CATALOGUE"
      ? "Online Radio only: browse rights-filtered FOCUSED catalogue metadata for Malta and save private station, playlist and weekly planner drafts. Audio playback, uploads, downloads, live broadcasting, publishing and paid actions remain blocked. No streaming service or audio storage is provisioned."
      : value === "ONLINE_DRAFT"
      ? "Online Radio only: save a private station, playlists and weekly planner drafts. Live broadcasting, uploads, downloads and paid actions remain blocked. No streaming service is provisioned."
      : "View the selected pillars in a separate sandbox. Saving changes, publishing, uploads and downloads are unavailable."}</p>
  </>;
}

function PillarChoices({ id, value, onChange, disabled }) {
  return (
    <fieldset disabled={disabled} style={{ marginTop: 20, padding: 16 }}>
      <legend>Allowed pillars — select one or more</legend>
      {SUBSCRIBER_PRODUCT_LIST.map((pillar) => (
        <label key={pillar.key} htmlFor={`${id}-${pillar.key}`} style={{ display: "block", padding: "5px 0" }}>
          <input id={`${id}-${pillar.key}`} type="checkbox" checked={value.includes(pillar.key)}
            onChange={(event) => onChange(event.target.checked
              ? [...value, pillar.key] : value.filter((key) => key !== pillar.key))} />{" "}
          {pillar.label}
        </label>
      ))}
    </fieldset>
  );
}

function TesterEditor({ tester, working, onSave }) {
  const [pillars, setPillars] = useState(tester.pillars || []);
  const [accessMode, setAccessMode] = useState(isPreviewOnlineDraftAccessMode(tester.accessMode) ? tester.accessMode : "READ_ONLY");
  const draftAccess = isPreviewOnlineDraftAccessMode(accessMode);
  const [enabled, setEnabled] = useState(Boolean(tester.enabled));
  const [password, setPassword] = useState("");
  const id = `preview-tester-${tester.id}`;
  const expiry = tester.expiresAt ? new Date(tester.expiresAt) : null;
  const expiryLabel = expiry && Number.isFinite(expiry.getTime()) ? expiry.toLocaleString() : "Unavailable";

  function submit(event) {
    event.preventDefault();
    const nextPassword = password;
    setPassword("");
    onSave({ userId: tester.id, pillars: draftAccess ? ["ONLINE"] : pillars, accessMode, enabled, ...(nextPassword ? { password: nextPassword } : {}) });
  }

  return (
    <article style={{ borderTop: "1px solid #b6c1d0", marginTop: 20, paddingTop: 16 }}>
      <h3 style={{ marginBottom: 6 }}>{tester.name}</h3>
      <p style={{ overflowWrap: "anywhere", marginTop: 0 }}>Username: {tester.email}</p>
      <p>{tester.enabled ? "Enabled" : "Disabled"} · {tester.passwordEnabled ? "Password sign-in available" : "Code-only sign-in"}<br />
        Access expires: {expiryLabel}</p>
      <p>Allowed pillars: {SUBSCRIBER_PRODUCT_LIST.filter((pillar) => tester.pillars?.includes(pillar.key))
        .map((pillar) => pillar.label).join(", ") || "None"}.</p>
      <p>Workspace access: {tester.accessMode === "ONLINE_DRAFT_CATALOGUE" ? "Online Radio drafts + Malta catalogue metadata (no audio)" : tester.accessMode === "ONLINE_DRAFT" ? "Editable Online Radio drafts only" : "Read-only"}.</p>
      <details>
        <summary>Edit this tester’s access</summary>
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <label htmlFor={`${id}-enabled`}>
            <input id={`${id}-enabled`} type="checkbox" checked={enabled} disabled={working}
              onChange={(event) => setEnabled(event.target.checked)} />{" "}
            Enable this tester’s access
          </label>
          <AccessModeChoice id={id} value={accessMode} disabled={working} onChange={(mode) => { setAccessMode(mode); if (isPreviewOnlineDraftAccessMode(mode)) setPillars(["ONLINE"]); }} />
          <PillarChoices id={id} value={draftAccess ? ["ONLINE"] : pillars} onChange={setPillars} disabled={working || draftAccess} />
          <label htmlFor={`${id}-password`} style={{ display: "block", marginTop: 20, fontWeight: 700 }}>
            Set or reset password (optional)
          </label>
          <input id={`${id}-password`} type="password" autoComplete="new-password" minLength={12} maxLength={72}
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={working}
            aria-describedby={`${id}-password-help`} style={inputStyle} />
          <p id={`${id}-password-help`}>Leave blank to keep the current sign-in method. Entering a password enables password sign-in. {passwordHelp}</p>
          <p>Saving, including a change of workspace access, signs this tester out of existing sessions. Saving enabled access starts a fresh 30-day access period. Disabling blocks sign-in.</p>
          <button type="submit" disabled={working || (!draftAccess && pillars.length === 0)}>
            {working ? "Please wait…" : "Save tester access"}
          </button>
        </form>
      </details>
    </article>
  );
}

export default function TesterControls({ initialTesters = EMPTY_TESTERS }) {
  const [testers, setTesters] = useState(Array.isArray(initialTesters) ? initialTesters : []);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(true);
  const [password, setPassword] = useState("");
  const [pillars, setPillars] = useState([]);
  const [accessMode, setAccessMode] = useState("READ_ONLY");
  const draftAccess = isPreviewOnlineDraftAccessMode(accessMode);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    setTesters(Array.isArray(initialTesters) ? initialTesters : []);
  }, [initialTesters]);

  async function saveTester(body, update = false) {
    if (pending.current) return;
    setMessage("");
    setFailed(false);
    if (!body.pillars.length) {
      setFailed(true);
      setMessage("Select at least one pillar for this tester.");
      return;
    }
    if (body.password !== undefined && (body.password.length < 12 || new TextEncoder().encode(body.password).length > 72)) {
      setFailed(true);
      setMessage("The password needs at least 12 characters and no more than 72 UTF-8 bytes. Please enter it again.");
      return;
    }
    pending.current = true;
    setWorking(true);
    try {
      const response = await fetch(endpoint, {
        method: update ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || !result.tester?.id) {
        setFailed(true);
        setMessage(typeof result.error === "string" ? result.error : "Unable to save this tester. Please try again.");
        return;
      }
      // Retain only the public account summary, never a response credential.
      const saved = {
        id: result.tester.id, email: result.tester.email, name: result.tester.name,
        enabled: result.tester.enabled, passwordEnabled: result.tester.passwordEnabled,
        pillars: result.tester.pillars, accessMode: result.tester.accessMode, expiresAt: result.tester.expiresAt
      };
      setTesters((current) => update
        ? current.map((tester) => tester.id === saved.id ? saved : tester)
        : [...current, saved]);
      if (!update) {
        setEmail("");
        setName("");
        setPillars([]);
        setAccessMode("READ_ONLY");
        setMessage(saved.passwordEnabled
          ? "Tester created. Send their email username and the password you chose privately. No email has been sent."
          : "Code-only tester created. Use their email in the one-use code controls to issue their access code. No email has been sent.");
      } else {
        setMessage(saved.enabled
          ? "Tester access saved for 30 days. Their previous sessions have been signed out."
          : "Tester disabled. Their previous sessions have been signed out.");
      }
    } catch {
      setFailed(true);
      setMessage("Unable to confirm the change. Refresh this page to check the tester list before trying again.");
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }

  function createTester(event) {
    event.preventDefault();
    const nextPassword = password;
    setPassword("");
    saveTester({ email: email.trim().toLowerCase(), name: name.trim(), pillars: draftAccess ? ["ONLINE"] : pillars, accessMode,
      ...(passwordEnabled ? { password: nextPassword } : {}) });
  }

  return (
    <section style={panelStyle} aria-labelledby="preview-testers-heading" aria-busy={working}>
      <h2 id="preview-testers-heading">Invited tester accounts</h2>
      <p>Only you, the owner, can create these non-admin accounts. Each tester gets a separate sandbox, not access to your administration or another tester’s data. Read-only is the default; you can explicitly allow private Online Radio drafts, with an optional Malta catalogue metadata view. Metadata access does not enable audio playback. Live broadcasting, uploads, downloads, paid actions and public registration stay closed.</p>
      <p>Access expires after 30 days. Up to 20 tester accounts can be created; no account deletion or automatic email is provided here. Temporary one-use codes are issued separately using the tester’s email.</p>
      <form onSubmit={createTester}>
        <fieldset disabled={working || testers.length >= 20} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>Create a tester</legend>
          <label htmlFor="preview-new-tester-name" style={{ display: "block", fontWeight: 700 }}>Tester name</label>
          <input id="preview-new-tester-name" type="text" autoComplete="off" required minLength={2} maxLength={80}
            value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} />
          <label htmlFor="preview-new-tester-email" style={{ display: "block", marginTop: 16, fontWeight: 700 }}>Email (used as their username)</label>
          <input id="preview-new-tester-email" type="email" autoComplete="off" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle} />
          <label htmlFor="preview-new-tester-password-enabled" style={{ display: "block", marginTop: 20 }}>
            <input id="preview-new-tester-password-enabled" type="checkbox" checked={passwordEnabled}
              onChange={(event) => { setPasswordEnabled(event.target.checked); setPassword(""); }} />{" "}
            Enable email and password sign-in
          </label>
          {passwordEnabled ? <>
            <label htmlFor="preview-new-tester-password" style={{ display: "block", marginTop: 16, fontWeight: 700 }}>Password you will give this tester</label>
            <input id="preview-new-tester-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72}
              value={password} onChange={(event) => setPassword(event.target.value)}
              aria-describedby="preview-new-tester-password-help" style={inputStyle} />
            <p id="preview-new-tester-password-help">{passwordHelp} The password field is cleared after each attempt and cannot be read back.</p>
          </> : <p>This tester will sign in only using a one-use code you issue. Create the account first, then use the one-use code controls to issue their code.</p>}
          <AccessModeChoice id="preview-new-tester" value={accessMode} disabled={working} onChange={(mode) => { setAccessMode(mode); if (isPreviewOnlineDraftAccessMode(mode)) setPillars(["ONLINE"]); }} />
          <PillarChoices id="preview-new-tester" value={draftAccess ? ["ONLINE"] : pillars} onChange={setPillars} disabled={working || draftAccess} />
          <button type="submit" disabled={working || (!draftAccess && pillars.length === 0)} style={{ marginTop: 20 }}>
            {working ? "Please wait…" : "Create tester account"}
          </button>
        </fieldset>
      </form>
      {testers.length >= 20 ? <p>The 20-account preview limit has been reached. You can still edit or disable existing testers.</p> : null}
      {message ? <p role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}>{message}</p> : null}
      <h3 style={{ marginTop: 28 }}>Existing testers ({testers.length} of 20)</h3>
      {testers.length === 0 ? <p>No tester accounts have been created yet.</p> : testers.map((tester) => (
        <TesterEditor key={`${tester.id}-${tester.enabled}-${tester.passwordEnabled}-${tester.accessMode}-${tester.expiresAt}-${tester.pillars.join(",")}`}
          tester={tester} working={working} onSave={(body) => saveTester(body, true)} />
      ))}
    </section>
  );
}
