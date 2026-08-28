"use client";

import { useState } from "react";

const AVAILABLE_SCOPES = ["organisation:read", "analytics:read", "reports:read", "media:read", "locations:read"];

async function callApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function OrganisationSecurityCard({ initialOrganisation }) {
  const [organisation, setOrganisation] = useState(initialOrganisation);
  const [policy, setPolicy] = useState({
    ...initialOrganisation.policy,
    domains: (initialOrganisation.policy.allowedEmailDomains || []).join(", ")
  });
  const [provider, setProvider] = useState({ name: "", protocol: "OIDC", issuer: "", clientId: "", metadataUrl: "", emailDomain: "" });
  const [account, setAccount] = useState({ name: "", description: "", scopes: ["organisation:read"], expiresAt: "" });
  const [revealedKey, setRevealedKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const body = await callApi(`/api/admin/security/organisations/${organisation.id}`);
    setOrganisation({
      id: body.organisation.id,
      name: body.organisation.name,
      policy: body.organisation.enterpriseSecurityPolicy || initialOrganisation.policy,
      identityProviders: body.organisation.enterpriseIdentityProviders,
      serviceAccounts: body.organisation.serviceAccounts
    });
  }

  async function savePolicy(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRevealedKey("");
    try {
      await callApi(`/api/admin/security/organisations/${organisation.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sessionMaxAgeMinutes: Number(policy.sessionMaxAgeMinutes),
          idleTimeoutMinutes: Number(policy.idleTimeoutMinutes),
          allowedEmailDomains: policy.domains.split(",").map((item) => item.trim()).filter(Boolean),
          passwordFallback: true,
          ssoRequired: false,
          identityProvider: provider.name && provider.issuer ? {
            ...provider,
            clientId: provider.clientId || null,
            metadataUrl: provider.metadataUrl || null,
            emailDomain: provider.emailDomain || null
          } : null
        })
      });
      await refresh();
      setMessage("Security settings saved. Existing login remains active.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function createAccount(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRevealedKey("");
    try {
      const body = await callApi("/api/admin/security/service-accounts", {
        method: "POST",
        body: JSON.stringify({
          organisationId: organisation.id,
          name: account.name,
          description: account.description || null,
          scopes: account.scopes,
          expiresAt: account.expiresAt ? new Date(account.expiresAt).toISOString() : null
        })
      });
      setRevealedKey(body.apiKey);
      setAccount({ name: "", description: "", scopes: ["organisation:read"], expiresAt: "" });
      await refresh();
      setMessage("Service account created. Copy the key before leaving this page.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function rotate(serviceAccountId) {
    setBusy(true); setMessage(""); setRevealedKey("");
    try {
      const body = await callApi(`/api/admin/security/service-accounts/${serviceAccountId}/keys`, { method: "POST", body: JSON.stringify({ name: "Rotated key" }) });
      setRevealedKey(body.apiKey);
      await refresh();
      setMessage("Previous active keys were revoked. Copy the replacement key now.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function revoke(serviceAccountId) {
    if (!window.confirm("Revoke this service account and all of its active API keys?")) return;
    setBusy(true); setMessage(""); setRevealedKey("");
    try {
      await callApi(`/api/admin/security/service-accounts/${serviceAccountId}/revoke`, { method: "POST", body: "{}" });
      await refresh();
      setMessage("Service account and its active keys were revoked.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function revokeSessions() {
    if (!window.confirm(`Sign out active users working in ${organisation.name}?`)) return;
    setBusy(true); setMessage(""); setRevealedKey("");
    try {
      const body = await callApi(`/api/admin/security/organisations/${organisation.id}/sessions/revoke`, { method: "POST", body: "{}" });
      setMessage(`${body.revokedSessionCount} organisation session${body.revokedSessionCount === 1 ? "" : "s"} revoked.`);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  function toggleScope(scope) {
    setAccount((current) => ({ ...current, scopes: current.scopes.includes(scope) ? current.scopes.filter((item) => item !== scope) : [...current.scopes, scope] }));
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.cardTitle}>{organisation.name}</h2>
      {message && <p style={styles.message}>{message}</p>}
      {revealedKey && <div style={styles.secret}><strong>One-time API key</strong><code style={styles.code}>{revealedKey}</code><button type="button" style={styles.secondary} onClick={() => navigator.clipboard.writeText(revealedKey)}>Copy key</button></div>}

      <form onSubmit={savePolicy} style={styles.section}>
        <h3 style={styles.sectionTitle}>Session policy</h3>
        <div style={styles.grid}>
          <label style={styles.label}>Maximum session age (minutes)<input style={styles.input} type="number" min="60" max="43200" value={policy.sessionMaxAgeMinutes} onChange={(event) => setPolicy({ ...policy, sessionMaxAgeMinutes: event.target.value })} /></label>
          <label style={styles.label}>Idle timeout (minutes)<input style={styles.input} type="number" min="15" value={policy.idleTimeoutMinutes} onChange={(event) => setPolicy({ ...policy, idleTimeoutMinutes: event.target.value })} /></label>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>Allowed email domains, separated by commas<input style={styles.input} value={policy.domains} placeholder="school.example, group.example" onChange={(event) => setPolicy({ ...policy, domains: event.target.value })} /></label>
        </div>

        <h3 style={styles.sectionTitle}>Identity provider preparation</h3>
        <p style={styles.help}>Optional metadata only. Saving it creates a draft connection; it does not change sign-in.</p>
        <div style={styles.grid}>
          <label style={styles.label}>Connection name<input style={styles.input} value={provider.name} onChange={(event) => setProvider({ ...provider, name: event.target.value })} placeholder="School Microsoft Entra" /></label>
          <label style={styles.label}>Protocol<select style={styles.input} value={provider.protocol} onChange={(event) => setProvider({ ...provider, protocol: event.target.value })}><option>OIDC</option><option>SAML</option></select></label>
          <label style={styles.label}>Issuer URL<input style={styles.input} type="url" value={provider.issuer} onChange={(event) => setProvider({ ...provider, issuer: event.target.value })} /></label>
          <label style={styles.label}>Client ID / entity ID<input style={styles.input} value={provider.clientId} onChange={(event) => setProvider({ ...provider, clientId: event.target.value })} /></label>
          <label style={styles.label}>Metadata URL<input style={styles.input} type="url" value={provider.metadataUrl} onChange={(event) => setProvider({ ...provider, metadataUrl: event.target.value })} /></label>
          <label style={styles.label}>Email domain<input style={styles.input} value={provider.emailDomain} onChange={(event) => setProvider({ ...provider, emailDomain: event.target.value })} /></label>
        </div>
        <button style={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save security settings"}</button>
        <button type="button" style={{ ...styles.danger, marginLeft: 10 }} disabled={busy} onClick={revokeSessions}>Revoke active sessions</button>
        {organisation.identityProviders.length > 0 && <p style={styles.help}>Draft connections: {organisation.identityProviders.map((item) => `${item.name} (${item.protocol}, ${item.status})`).join(", ")}</p>}
      </form>

      <form onSubmit={createAccount} style={styles.section}>
        <h3 style={styles.sectionTitle}>Service accounts</h3>
        <div style={styles.grid}>
          <label style={styles.label}>Account name<input required style={styles.input} value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} /></label>
          <label style={styles.label}>Expiry (optional)<input style={styles.input} type="datetime-local" value={account.expiresAt} onChange={(event) => setAccount({ ...account, expiresAt: event.target.value })} /></label>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>Purpose<input style={styles.input} value={account.description} onChange={(event) => setAccount({ ...account, description: event.target.value })} placeholder="Reporting integration" /></label>
        </div>
        <div style={styles.scopeRow}>{AVAILABLE_SCOPES.map((scope) => <label key={scope} style={styles.scope}><input type="checkbox" checked={account.scopes.includes(scope)} onChange={() => toggleScope(scope)} /> {scope}</label>)}</div>
        <button style={styles.primary} disabled={busy || account.scopes.length === 0}>{busy ? "Working…" : "Create account & key"}</button>
        <div style={styles.accounts}>{organisation.serviceAccounts.map((item) => <div key={item.id} style={styles.account}><div><strong>{item.name}</strong><div style={styles.help}>{item.status} · {item.scopes.join(", ")} · Last used {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : "never"}</div><div style={styles.help}>Keys: {item.apiKeys.map((key) => `${key.prefix} (${key.status})`).join(", ") || "none"}</div></div>{item.status === "ACTIVE" && <div style={styles.actions}><button type="button" style={styles.secondary} disabled={busy} onClick={() => rotate(item.id)}>Rotate key</button><button type="button" style={styles.danger} disabled={busy} onClick={() => revoke(item.id)}>Revoke</button></div>}</div>)}</div>
      </form>
    </section>
  );
}

export default function EnterpriseSecurityControls({ organisations }) {
  return <div style={styles.stack}>{organisations.map((organisation) => <OrganisationSecurityCard key={organisation.id} initialOrganisation={organisation} />)}</div>;
}

const styles = {
  stack: { display: "grid", gap: 22 },
  card: { padding: 22, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" },
  cardTitle: { margin: "0 0 14px", color: "#111827", fontSize: 23 },
  section: { marginTop: 18, padding: 18, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  sectionTitle: { margin: "0 0 10px", color: "#172033", fontSize: 17 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 },
  label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", fontSize: 14 },
  help: { margin: "7px 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 },
  scopeRow: { display: "flex", gap: 10, flexWrap: "wrap", margin: "14px 0" },
  scope: { padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 7, color: "#334155", fontSize: 12, fontWeight: 750 },
  primary: { marginTop: 12, padding: "10px 14px", border: 0, borderRadius: 7, background: "#172033", color: "#fff", fontWeight: 850, cursor: "pointer" },
  secondary: { padding: "8px 11px", border: "1px solid #64748b", borderRadius: 7, background: "#fff", color: "#172033", fontWeight: 800, cursor: "pointer" },
  danger: { padding: "8px 11px", border: "1px solid #b42318", borderRadius: 7, background: "#fff", color: "#b42318", fontWeight: 800, cursor: "pointer" },
  message: { padding: 10, borderRadius: 7, background: "#e8f4ff", color: "#164e75", fontSize: 13, fontWeight: 750 },
  secret: { display: "grid", gap: 8, padding: 14, border: "2px solid #15803d", borderRadius: 9, background: "#f0fdf4", color: "#14532d" },
  code: { display: "block", overflowWrap: "anywhere", padding: 10, borderRadius: 6, background: "#172033", color: "#fff", fontSize: 13 },
  accounts: { display: "grid", gap: 9, marginTop: 16 },
  account: { display: "flex", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid #e2e8f0", borderRadius: 7, alignItems: "center", flexWrap: "wrap" },
  actions: { display: "flex", gap: 8 }
};

