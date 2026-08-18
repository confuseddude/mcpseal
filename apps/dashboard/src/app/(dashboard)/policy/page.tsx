"use client";

import { useEffect, useState } from "react";
import { api, type PolicyRow } from "@/lib/api";

export default function PolicyPage() {
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [draft, setDraft] = useState('{\n  "version": 1,\n  "servers": {}\n}');
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.policies().then((res) => setPolicies(res.policies));
  }

  useEffect(refresh, []);

  async function onCreate() {
    setError(null);
    try {
      await api.createPolicy(draft);
      refresh();
    } catch {
      setError("Couldn't save that policy — check the JSON and your permissions.");
    }
  }

  return (
    <div>
      <h1 className="text-lg font-medium text-[var(--color-text)]">Policy</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-[var(--color-text-dim)]">
        The canonical org lockfile. Signed distribution to the fleet arrives in a later milestone — for now, new
        versions are saved unsigned, as drafts an admin can review.
      </p>

      <div className="mb-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-data text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-severity-info)]"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={onCreate}
            className="rounded-md bg-[var(--color-text)] px-3 py-1.5 text-xs font-medium text-[var(--color-bg)]"
          >
            Save as new version
          </button>
          {error && <span className="text-xs text-[var(--color-severity-high)]">{error}</span>}
        </div>
      </div>

      {policies === null ? (
        <p className="font-data text-sm text-[var(--color-text-faint)]">loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {policies.map((p) => (
            <div key={p.id} className="rounded-lg border border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="font-data text-sm text-[var(--color-text)]">v{p.version}</span>
                <span className="font-data text-xs text-[var(--color-text-faint)]">{new Date(p.createdAt).toLocaleString()}</span>
                <span className={`font-data text-xs ${p.signature ? "text-[var(--color-ok)]" : "text-[var(--color-text-faint)]"}`}>
                  {p.signature ? "signed" : "unsigned draft"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
