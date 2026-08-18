"use client";

import { useEffect, useState } from "react";
import { api, type Subscription } from "@/lib/api";

// build-bible.md Part 7.3: "Gate on the visibility cap, transparently...
// never hide the value; show the locked door with a window in it." The
// subscription check below is real (hits the App API); the actual
// tamper-evident audit export behind the lock is Milestone 6 — this page
// is honest about that rather than faking data behind the paywall.
export default function AuditPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof api.auditExport>> | null>(null);

  useEffect(() => {
    api.subscription().then((res) => {
      setSubscription(res.subscription);
      if (res.subscription.plan === "enterprise") {
        api.auditExport().then(setAudit).catch(() => setAudit(null));
      }
    });
  }, []);

  const isEnterprise = subscription?.plan === "enterprise";
  const allChainsValid = audit ? Object.values(audit.verification).every((v) => v.valid) : null;

  return (
    <div>
      <h1 className="text-lg font-medium text-[var(--color-text)]">Audit</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-[var(--color-text-dim)]">
        A searchable, exportable, tamper-evident record of every blocked event — hash-chained so deletion or editing
        is provably detectable.
      </p>

      {isEnterprise && audit && (
        <div className="mb-4 flex items-center gap-2">
          <span className={`font-data text-xs ${allChainsValid ? "text-[var(--color-ok)]" : "text-[var(--color-severity-high)]"}`}>
            {allChainsValid ? "✓ chain intact" : "✗ chain integrity FAILED"}
          </span>
          <span className="font-data text-xs text-[var(--color-text-faint)]">{audit.events.length} event(s)</span>
        </div>
      )}

      <div className="relative overflow-hidden rounded-lg border border-[var(--color-border)]">
        <div className={`p-6 ${!isEnterprise ? "pointer-events-none blur-[3px] select-none" : ""}`}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                <th className="py-2 font-normal">Event</th>
                <th className="py-2 font-normal">Chain hash</th>
              </tr>
            </thead>
            <tbody>
              {(isEnterprise && audit
                ? audit.events.map((e) => ({ label: `${e.type} · ${e.server}/${e.tool}`, hash: e.chainHash, key: e.eventId }))
                : ["blocked_drift · github/create_issue", "blocked_unknown · slack/post_message", "blocked_denied · notion/delete_page"].map(
                    (label) => ({ label, hash: "sha256:•••••••••", key: label })
                  )
              ).map((row) => (
                <tr key={row.key} className="border-b border-[var(--color-border)]">
                  <td className="py-2.5 font-data text-xs text-[var(--color-text)]">{row.label}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-dim)]">{row.hash.slice(0, 20)}…</td>
                </tr>
              ))}
              {isEnterprise && audit && audit.events.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-sm text-[var(--color-text-dim)]">
                    No events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!isEnterprise && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-bg)]/70">
            <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1 font-data text-xs uppercase tracking-wide text-[var(--color-text)]">
              Enterprise
            </span>
            <p className="max-w-sm text-center text-sm text-[var(--color-text-dim)]">
              Tamper-evident audit export, with a hash chain your auditor can independently verify, is included on
              Enterprise.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
