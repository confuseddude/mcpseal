"use client";

import { useEffect, useState } from "react";
import { api, type Me, type ApiKeyRow, type Subscription } from "@/lib/api";

export default function SettingsPage() {
  const [members, setMembers] = useState<Me[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[] | null>(null);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

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
            None yet. Run <span className="font-data text-[var(--color-text)]">mcplock login</span> on a machine to
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
