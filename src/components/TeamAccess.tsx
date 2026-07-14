import { useCallback, useEffect, useState } from "react";
import { useArgusAuth, type ArgusRole } from "../auth-context";

interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string;
  role: ArgusRole;
  active: boolean;
  emailVerified: boolean;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemberEvent {
  id: string;
  targetEmail: string;
  actorEmail: string | null;
  type: string;
  createdAt: string;
}

interface MembersResponse {
  members?: WorkspaceMember[];
  events?: MemberEvent[];
  currentUserId?: string;
  member?: WorkspaceMember;
  invitationSent?: boolean;
  invitationResent?: boolean;
  error?: string;
  message?: string;
}

const ROLE_COPY: Record<ArgusRole, string> = {
  owner: "Manage access and owner-only actions",
  analyst: "Run investigations and update cases",
  viewer: "Read reports without running paid work",
};

const EVENT_COPY: Record<string, string> = {
  "member.invited": "sent an invite to",
  "member.access_granted": "granted access to",
  "member.role_changed": "changed the role for",
  "member.access_disabled": "disabled",
  "member.access_enabled": "restored",
  "member.profile_updated": "updated",
};

function relativeTime(value: string | null): string {
  if (!value) return "never signed in";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function responseBody(response: Response): Promise<MembersResponse> {
  const body = await response.json().catch(() => ({})) as MembersResponse;
  if (!response.ok) throw new Error(body.message || body.error || "Workspace access could not be updated.");
  return body;
}

export function TeamAccess() {
  const auth = useArgusAuth();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<ArgusRole>("analyst");
  const [inviting, setInviting] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (auth.role !== "owner") return;
    setLoading(true);
    try {
      const body = await responseBody(await fetch("/api/members"));
      setMembers(body.members || []);
      setEvents(body.events || []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workspace access could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [auth.role]);

  useEffect(() => {
    if (auth.role !== "owner") return;
    let active = true;
    const bootstrap = async () => {
      try {
        const body = await responseBody(await fetch("/api/members"));
        if (!active) return;
        setMembers(body.members || []);
        setEvents(body.events || []);
        setError("");
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Workspace access could not be loaded.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void bootstrap();
    return () => { active = false; };
  }, [auth.role]);

  if (auth.role !== "owner") return null;

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inviting) return;
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const body = await responseBody(await fetch("/api/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, displayName, role }),
      }));
      setNotice(body.invitationResent
        ? `Fresh invitation sent to ${email.trim().toLowerCase()}.`
        : body.invitationSent
          ? `Invitation sent to ${email.trim().toLowerCase()}.`
        : `${email.trim().toLowerCase()} can now sign in to ARGUS.`);
      setEmail("");
      setDisplayName("");
      setRole("analyst");
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "The invitation could not be sent.");
    } finally {
      setInviting(false);
    }
  };

  const updateMember = async (
    member: WorkspaceMember,
    change: { role?: ArgusRole; active?: boolean },
  ) => {
    if (updatingUserId || resendingUserId) return;
    const nextActive = change.active ?? member.active;
    if (!nextActive && !window.confirm(`Disable ARGUS access for ${member.email}? Their reports remain in the workspace.`)) return;
    setUpdatingUserId(member.userId);
    setError("");
    setNotice("");
    try {
      await responseBody(await fetch("/api/members", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.userId, ...change }),
      }));
      setNotice(`${member.email} was updated.`);
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Access could not be updated.");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const resendInvitation = async (member: WorkspaceMember) => {
    if (updatingUserId || resendingUserId || member.emailVerified || !member.active) return;
    setResendingUserId(member.userId);
    setError("");
    setNotice("");
    try {
      await responseBody(await fetch("/api/members", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: member.userId, resendInvitation: true }),
      }));
      setNotice(`Fresh invitation sent to ${member.email}.`);
      await load();
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "The invitation could not be resent.");
    } finally {
      setResendingUserId(null);
    }
  };

  return (
    <section className="panel mt-6 overflow-hidden" aria-labelledby="workspace-access-title">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="workspace-access-title" className="text-[15px] font-medium text-ink">Workspace access</h2>
              <span className="chip tint-signal">owner only</span>
            </div>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
              Invite verified investigators, set their authority, or suspend access without deleting their work.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-chip disabled:opacity-50"
          >
            {loading ? "checking…" : "refresh"}
          </button>
        </div>

        <form onSubmit={invite} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_130px_auto]">
          <label className="sr-only" htmlFor="member-email">Work email</label>
          <input
            id="member-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="partner@company.com"
            className="field mono min-w-0 px-3 py-2 text-[12.5px]"
          />
          <label className="sr-only" htmlFor="member-display-name">Display name</label>
          <input
            id="member-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Display name"
            maxLength={80}
            className="field min-w-0 px-3 py-2 text-[12.5px]"
          />
          <label className="sr-only" htmlFor="member-role">Role</label>
          <select
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as ArgusRole)}
            title={ROLE_COPY[role]}
            className="field mono px-2.5 py-2 text-[12.5px]"
          >
            <option value="analyst">Analyst</option>
            <option value="viewer">Viewer</option>
            <option value="owner">Owner</option>
          </select>
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="btn-primary whitespace-nowrap px-4 py-2 text-[12.5px] font-medium"
          >
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </form>
        <p className="mt-1.5 text-[11px] text-ink-faint">{ROLE_COPY[role]}. New accounts receive a secure Supabase invitation.</p>
        {notice && <div role="status" className="tint-pass mt-3 rounded-lg border px-3 py-2 text-[12.5px]">{notice}</div>}
        {error && <div role="alert" className="tint-avoid mt-3 rounded-lg border px-3 py-2 text-[12.5px]">{error}</div>}
      </div>

      <div aria-live="polite">
        {loading && members.length === 0 ? (
          <div className="px-5 py-6 text-[12.5px] text-ink-faint">Loading verified workspace members…</div>
        ) : members.length === 0 ? (
          <div className="px-5 py-6 text-[12.5px] text-ink-faint">No workspace members have been provisioned.</div>
        ) : members.map((member) => {
          const isSelf = member.userId === auth.user.id;
          const updating = updatingUserId === member.userId;
          const resending = resendingUserId === member.userId;
          const pending = updating || resending;
          return (
            <div key={member.userId} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] font-medium text-signal-lift">
                {(member.displayName[0] || member.email[0] || "?").toUpperCase()}
              </span>
              <span className="min-w-[180px] flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink">
                  {member.displayName}
                  {isSelf && <span className="chip tint-signal">you</span>}
                  {!member.active && <span className="chip tint-avoid">disabled</span>}
                </span>
                <span className="mono mt-0.5 block text-[11px] text-ink-faint">{member.email}</span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  {member.lastSignInAt
                    ? "signed in"
                    : member.emailVerified
                      ? "sign-in ready"
                      : "invitation pending"} · {relativeTime(member.lastSignInAt)}
                </span>
              </span>
              {!member.emailVerified && member.active && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void resendInvitation(member)}
                  className="btn-chip whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {resending ? "sending…" : "resend invite"}
                </button>
              )}
              <select
                aria-label={`Role for ${member.email}`}
                value={member.role}
                disabled={pending || isSelf}
                onChange={(event) => void updateMember(member, { role: event.target.value as ArgusRole })}
                title={isSelf ? "Another owner must change your access." : ROLE_COPY[member.role]}
                className="field mono px-2 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <option value="owner">Owner</option>
                <option value="analyst">Analyst</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                disabled={pending || isSelf}
                onClick={() => void updateMember(member, { active: !member.active })}
                className="btn-chip min-w-[70px] justify-center disabled:cursor-not-allowed disabled:opacity-45"
              >
                {updating ? "saving…" : member.active ? "disable" : "restore"}
              </button>
            </div>
          );
        })}
      </div>

      {events.length > 0 && (
        <details className="border-t border-line px-5 py-3">
          <summary className="cursor-pointer text-[11px] font-medium text-ink-dim">Recent access activity</summary>
          <div className="mt-2 space-y-1.5">
            {events.slice(0, 8).map((event) => (
              <div key={event.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-ink-faint">
                <span className="mono text-ink-dim">{event.actorEmail || "system"}</span>
                <span>{EVENT_COPY[event.type] || "updated"}</span>
                <span className="mono text-ink-dim">{event.targetEmail}</span>
                <span className="ml-auto mono">{relativeTime(event.createdAt)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
