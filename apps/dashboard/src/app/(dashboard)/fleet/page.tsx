"use client";

import { useEffect, useState } from "react";
import { api, type MachineRow } from "@/lib/api";

function isStale(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() > 24 * 60 * 60 * 1000;
}

export default function FleetPage() {
  const [machines, setMachines] = useState<MachineRow[] | null>(null);

  useEffect(() => {
    api.machines().then((res) => setMachines(res.machines));
  }, []);

  return (
    <div>
      <h1 className="text-lg font-medium text-[var(--color-text)]">Fleet</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-text-dim)]">
        Every machine that has ever connected mcpseal to this workspace.
      </p>

      {machines === null ? (
        <p className="font-data text-sm text-[var(--color-text-faint)]">loading…</p>
      ) : machines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] px-6 py-16 text-center">
          <p className="text-sm text-[var(--color-text-dim)]">No machines connected yet.</p>
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
              <th className="py-2 font-normal">Machine</th>
              <th className="py-2 font-normal">Version</th>
              <th className="py-2 font-normal">First seen</th>
              <th className="py-2 font-normal">Last seen</th>
              <th className="py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => {
              const stale = isStale(m.last_seen);
              return (
                <tr key={m.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2.5 font-data text-xs text-[var(--color-text)]">{m.machine_id}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-dim)]">{m.mcpseal_version ?? "—"}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-dim)]">{new Date(m.first_seen).toLocaleDateString()}</td>
                  <td className="py-2.5 font-data text-xs text-[var(--color-text-dim)]">{new Date(m.last_seen).toLocaleString()}</td>
                  <td className="py-2.5">
                    <span className={`font-data text-xs ${stale ? "text-[var(--color-severity-medium)]" : "text-[var(--color-ok)]"}`}>
                      {stale ? "stale" : "connected"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
