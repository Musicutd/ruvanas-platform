"use client";

import { useEffect, useState } from "react";
import styles from "./team-workspace.module.css";

const roleDetails = {
  OWNER: ["Owner", "Full organisation and team control"],
  MANAGER: ["Manager", "Daily operations and limited team administration"],
  CONTENT_EDITOR: ["Content editor", "Creates programming and audio"],
  VIEWER: ["Viewer", "Read-only access"]
};

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export default function TeamWorkspace() {
  const [data, setData] = useState(null);
  const [invite, setInvite] = useState({ email: "", role: "CONTENT_EDITOR" });
  const [organisationName, setOrganisationName] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/organisation/team", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load organisation settings.");
      setData(payload);
      setOrganisationName(payload.organisation.name);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function request(method, body, successMessage) {
    setWorking(body.action || "INVITE");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/organisation/team", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The team change could not be saved.");
      if (payload.invitationPath) {
        setInvitationUrl(`${window.location.origin}${payload.invitationPath}`);
        setInvite({ email: "", role: "CONTENT_EDITOR" });
      }
      setNotice(successMessage);
      await load();
      return payload;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setWorking("");
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setNotice("Private invitation link copied.");
    } catch {
      setNotice("Select and copy the invitation link manually.");
    }
  }

  function canManageMember(member) {
    if (!data.permissions.canManage || member.userId === data.currentUserId) return false;
    if (data.currentRole === "OWNER") return member.role !== "OWNER";
    return data.currentRole === "MANAGER" && ["CONTENT_EDITOR", "VIEWER"].includes(member.role);
  }

  const assignableRoles = data?.currentRole === "OWNER"
    ? ["MANAGER", "CONTENT_EDITOR", "VIEWER"]
    : ["CONTENT_EDITOR", "VIEWER"];

  if (!data) return <main className={styles.page}><div className={styles.shell}><a href="/dashboard" className={styles.back}>← Dashboard</a><p className={styles.loading}>{error || "Loading your organisation team…"}</p></div></main>;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.topNav}><a href="/dashboard" className={styles.brand}>RUVANAS</a><div><a href="/dashboard">Dashboard</a><a href="/dashboard/help">Help</a><a href="/dashboard/support">Support</a></div></nav>

        <header className={styles.hero}>
          <div><p className={styles.eyebrow}>ORGANISATION & ACCESS</p><h1>Your team</h1><p>Keep responsibilities clear and give every colleague only the access they need.</p></div>
          <span className={styles.roleBadge}>{roleDetails[data.currentRole]?.[0] || data.currentRole}</span>
        </header>

        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <section className={styles.summaryGrid}>
          <article className={styles.organisationCard}>
            <p className={styles.eyebrow}>ORGANISATION PROFILE</p>
            <h2>{data.organisation.name}</h2>
            <dl><div><dt>Plan</dt><dd>{data.organisation.planName}</dd></div><div><dt>Status</dt><dd>{data.organisation.subscriptionStatus.toLowerCase()}</dd></div><div><dt>Team members</dt><dd>{data.members.length}</dd></div></dl>
            {data.permissions.canRenameOrganisation ? <form onSubmit={(event) => { event.preventDefault(); request("PATCH", { action: "UPDATE_ORGANISATION", name: organisationName }, "Organisation name updated."); }} className={styles.renameForm}><label>Organisation display name<input value={organisationName} onChange={(event) => setOrganisationName(event.target.value)} minLength="2" maxLength="100" required /></label><button disabled={Boolean(working)}>Save name</button></form> : null}
          </article>

          <aside className={styles.accessGuide}>
            <p className={styles.eyebrow}>ACCESS GUIDE</p><h2>Choose the smallest suitable role</h2>
            <ul>{Object.entries(roleDetails).map(([role, details]) => <li key={role}><strong>{details[0]}</strong><span>{details[1]}</span></li>)}</ul>
          </aside>
        </section>

        {data.permissions.canManage ? <section className={styles.inviteSection}>
          <div><p className={styles.eyebrow}>ADD A COLLEAGUE</p><h2>Create a private invitation</h2><p>The one-time link expires after seven days. Ruvanas does not email it automatically, so you stay in control of how it is shared.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); request("POST", invite, "Invitation created. Copy the private link now."); }} className={styles.inviteForm}>
            <label>Email address<input type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required /></label>
            <label>Team role<select value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value }))}>{assignableRoles.map((role) => <option key={role} value={role}>{roleDetails[role][0]}</option>)}</select></label>
            <button disabled={Boolean(working)}>{working === "INVITE" ? "Creating…" : "Create invitation"}</button>
          </form>
          {invitationUrl ? <div className={styles.invitationLink}><label>One-time private link<input readOnly value={invitationUrl} onFocus={(event) => event.target.select()} /></label><button onClick={copyInvitation}>Copy link</button></div> : null}
        </section> : null}

        <section className={styles.teamSection}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>CURRENT ACCESS</p><h2>Team members</h2></div><span>{data.members.length} active</span></div>
          <div className={styles.memberList}>{data.members.map((member) => {
            const manageable = canManageMember(member);
            return <article key={member.id} className={styles.memberCard}>
              <div className={styles.avatar}>{(member.name || member.email || "T").slice(0, 1).toUpperCase()}</div>
              <div className={styles.memberIdentity}><strong>{member.name}</strong><span>{member.email || "Email hidden"}</span><small>Joined {formatDate(member.joinedAt)}</small></div>
              <div className={styles.memberRole}><span>{roleDetails[member.role]?.[0] || member.role}</span><small>{member.userId === data.currentUserId ? "You" : "Active"}</small></div>
              {manageable ? <div className={styles.memberActions}>
                <select aria-label={`Role for ${member.name}`} defaultValue={member.role} onChange={(event) => request("PATCH", { action: "UPDATE_ROLE", memberId: member.id, role: event.target.value }, `${member.name}'s role was updated.`)} disabled={Boolean(working)}>{assignableRoles.map((role) => <option key={role} value={role}>{roleDetails[role][0]}</option>)}</select>
                <button className={styles.remove} disabled={Boolean(working)} onClick={() => { if (window.confirm(`Remove ${member.name} from ${data.organisation.name}?`)) request("PATCH", { action: "REMOVE_MEMBER", memberId: member.id }, `${member.name} no longer has access.`); }}>Remove</button>
              </div> : null}
            </article>;
          })}</div>
        </section>

        {data.permissions.canManage && data.invitations.length ? <section className={styles.pendingSection}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>WAITING TO JOIN</p><h2>Active invitations</h2></div><span>{data.invitations.length} pending</span></div>
          <div className={styles.pendingList}>{data.invitations.map((item) => <article key={item.id}><div><strong>{item.email}</strong><span>{roleDetails[item.role]?.[0] || item.role} · expires {formatDate(item.expiresAt)}</span><small>Created by {item.invitedBy}</small></div><button onClick={() => request("PATCH", { action: "REVOKE_INVITATION", invitationId: item.id }, `Invitation for ${item.email} revoked.`)} disabled={Boolean(working)}>Revoke</button></article>)}</div>
        </section> : null}

        <footer className={styles.footer}><strong>Access changes are recorded.</strong><span>Team invitations, role updates, profile changes and removals are kept in the organisation audit history.</span></footer>
      </div>
    </main>
  );
}
