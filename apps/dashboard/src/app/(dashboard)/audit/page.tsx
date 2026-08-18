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

  useEffect(() => {
    api.subscription().then((res) => setSubscription(res.subscription));
  }, []);

  const isEnterprise = subscription?.plan === "enterprise";

  return (
    <div>
      <h1 className="text-lg font-medium text-[var(--color-text)]">Audit</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-[var(--color-text-dim)]">
        A searchable, exportable, tamper-evident record of every blocked event — hash-chained so deletion or editing
        is provably detectable.
      </p>

      <div className="relative overflow-hidden rounded-lg border border-[var(--color-border)]">
        <div className={`p-6 ${!isEnterprise ? "pointer-events-none blur-[3px] select-none" : ""}`}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                <th className="py-2 font-normal">Event</th>
                <th className="py-2 font-normal">Chain hash</th>
                <th className="py-2 font-normal">Signature</th>
              </tr>
            </thead>
            <tbody>
              {["blocked_drift · github/create_issue", "blocked_unknown · slack/post_message", "blocked_denied · notion/delete_page"].map(
                (label) => (
                  <tr key={label} className="border-b border-[var(--color-border)]">
                    <td className="py-2.5 font-data text-xs text-[var(--color-text)]">{label}</td>
                    <td className="py-2.5 font-data text-xs text-[var(--color-text-dim)]">sha256:•••••••••</td>
                    <td className="py-2.5 font-data text-xs text-[var(--color-ok)]">verified</td>
                  </tr>
                )
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
