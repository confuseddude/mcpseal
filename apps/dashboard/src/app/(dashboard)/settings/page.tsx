"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Me, type ApiKeyRow, type Subscription } from "@/lib/api";

export default function SettingsPage() {
  const [members, setMembers] = useState<Me[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[] | null>(null);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [connectCode, setConnectCode] = useState("");
  const [connectStatus, setConnectStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!connectCode.trim()) return;
    setConnecting(true);
    setConnectStatus(null);
    try {
      await api.connectMachine(connectCode.trim());
      setConnectStatus({ kind: "ok", message: "Approved — the waiting mcpseal login on that machine will pick this up automatically." });
      setConnectCode("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not connect that code.";
      setConnectStatus({ kind: "error", message });
    } finally {
      setConnecting(false);
    }
  }

  function refreshMembers() {
    api.members().then((res) => setMembers(res.members));
  }

  useEffect(() => {
    refreshMembers();
    api
      .apiKeys()
      .then((res) => setApiKeys(res.apiKeys))
      .catch(() => setApiKeysError("Admin or owner role required to view API keys."));
    api.subscription().then((res) => setSubscription(res.subscription));
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-lg font-medium text-[var(--color-text)]">Settings</h1>
      </div>

      <Section title="Connect a machine">
        <p className="mb-3 text-sm text-[var(--color-text-dim)]">
          Run <span className="font-data text-[var(--color-text)]">mcpseal login</span> on a machine, then enter the
          code it prints here to approve it into this workspace.
        </p>
        <form onSubmit={handleConnect} className="flex items-center gap-2">
          <input
            value={connectCode}
            onChange={(e) => setConnectCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={12}
            className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-data text-sm tracking-widest text-[var(--color-text)] uppercase placeholder:text-[var(--color-text-faint)]"
          />
          <button
            type="submit"
            disabled={connecting || !connectCode.trim()}
            className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </form>
        {connectStatus && (
          <p
            className={`mt-2 text-sm ${connectStatus.kind === "ok" ? "text-[var(--color-ok)]" : "text-[var(--color-severity-high)]"}`}
          >
            {connectStatus.message}
          </p>
        )}
      </Section>

      <Section title="Members">
        {members === null ? (
          <Loading />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                <th className="py-2 font-normal">Email</th>
                <th className="py-2 font-normal">Role</th>
                <th className="py-2 font-normal">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2.5 text-sm text-[var(--color-text)]">{m.email}</td>
                  <td className="py-2.5">
                    <select
                      defaultValue={m.role}
                      onChange={(e) => api.setRole(m.id, e.target.value as Me["role"]).then(refreshMembers)}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-data text-xs text-[var(--color-text)]"
                    >
                      {["owner", "admin", "member", "viewer"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-faint)]">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="API keys">
        {apiKeysError ? (
          <p className="text-sm text-[var(--color-text-dim)]">{apiKeysError}</p>
        ) : apiKeys === null ? (
          <Loading />
        ) : apiKeys.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">
            None yet. Run <span className="font-data text-[var(--color-text)]">mcpseal login</span> on a machine to
            create one.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                <th className="py-2 font-normal">Name</th>
                <th className="py-2 font-normal">Created</th>
                <th className="py-2 font-normal">Last used</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((k) => (
                <tr key={k.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2.5 font-data text-xs text-[var(--color-text)]">{k.name}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-faint)]">{new Date(k.created_at).toLocaleDateString()}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-faint)]">
                    {k.last_used ? new Date(k.last_used).toLocaleString() : "never"}
                  </td>
                  <td className="py-2.5 font-data text-xs">
                    {k.revoked_at ? (
                      <span className="text-[var(--color-severity-high)]">revoked</span>
                    ) : (
                      <span className="text-[var(--color-ok)]">active</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {!k.revoked_at && (
                      <button
                        onClick={() => api.revokeApiKey(k.key_id).then(() => api.apiKeys().then((r) => setApiKeys(r.apiKeys)))}
                        className="text-xs text-[var(--color-severity-high)] hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Billing">
        {subscription === null ? (
          <Loading />
        ) : (
          <div className="flex items-center gap-3">
            <span className="font-data text-sm uppercase text-[var(--color-text)]">{subscription.plan}</span>
            <span className="font-data text-xs text-[var(--color-text-faint)]">
              {subscription.seats} seat{subscription.seats === 1 ? "" : "s"} · {subscription.status}
            </span>
            <span className="ml-auto flex gap-2">
              {subscription.plan === "free" && (
                <button
                  onClick={() => api.checkout(window.location.href).then((r) => (window.location.href = r.url))}
                  className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)]"
                >
                  Upgrade to Team
                </button>
              )}
              {subscription.plan !== "free" && (
                <button
                  onClick={() => api.billingPortal(window.location.href).then((r) => (window.location.href = r.url))}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                >
                  Manage billing
                </button>
              )}
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-[var(--color-text)]">{title}</h2>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">{children}</div>
    </section>
  );
}

function Loading() {
  return <p className="font-data text-sm text-[var(--color-text-faint)]">loading…</p>;
}
