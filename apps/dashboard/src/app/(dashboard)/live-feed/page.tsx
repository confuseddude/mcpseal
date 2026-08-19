"use client";

import { useEffect, useState } from "react";
import { api, type McpsealEventRow } from "@/lib/api";
import { SeverityChip } from "@/components/SeverityChip";
import { DescriptionDiff } from "@/components/DescriptionDiff";
import { describeEventType } from "@/lib/event-taxonomy";

const POLL_INTERVAL_MS = 4000;

export default function LiveFeedPage() {
  const [events, setEvents] = useState<McpsealEventRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await api.events(200);
        if (!cancelled) setEvents(res.events);
      } catch {
        // Transient poll failures shouldn't blank the screen — keep
        // showing the last-known feed rather than an error state.
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-medium text-[var(--color-text)]">Live Feed</h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">
            Every blocked tool across every machine in your workspace, as it happens.
          </p>
        </div>
      </div>

      {events === null ? (
        <p className="font-data text-sm text-[var(--color-text-faint)]">loading…</p>
      ) : events.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <div key={e.event_id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <button
                onClick={() => setExpanded(expanded === e.event_id ? null : e.event_id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left"
              >
                <span className="font-data text-xs text-[var(--color-text-faint)] w-40 shrink-0">
                  {new Date(e.ts).toLocaleString()}
                </span>
                <SeverityChip severity={e.severity} />
                <span className="font-data text-sm text-[var(--color-text)]">
                  {e.server}/{e.tool}
                </span>
                <span className="font-data text-xs text-[var(--color-text-dim)]">{e.type}</span>
                <span className="ml-auto font-data text-xs text-[var(--color-text-faint)]">{e.client_app}</span>
              </button>
              {expanded === e.event_id && (
                <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3">
                  <EventExplanation event={e} />
                  {e.description_diff && <DescriptionDiff diff={e.description_diff} />}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-data text-xs text-[var(--color-text-dim)]">
                    <dt className="text-[var(--color-text-faint)]">machine</dt>
                    <dd className="text-[var(--color-text)]">{e.machine_id}</dd>
                    {e.expected_hash && (
                      <>
                        <dt className="text-[var(--color-text-faint)]">expected hash</dt>
                        <dd className="text-[var(--color-text)] break-all">{e.expected_hash}</dd>
                      </>
                    )}
                    {e.observed_hash && (
                      <>
                        <dt className="text-[var(--color-text-faint)]">observed hash</dt>
                        <dd className="text-[var(--color-text)] break-all">{e.observed_hash}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventExplanation({ event }: { event: McpsealEventRow }) {
  const desc = describeEventType(event.type);
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <p className="text-sm text-[var(--color-text)]">{desc.summary}</p>
      <p className="mt-1 font-data text-xs text-[var(--color-text-dim)]">consequence: {desc.consequence}</p>
      {desc.cliRemediation.length > 0 && (
        <div className="mt-2 font-data text-xs text-[var(--color-text-faint)]">
          next, on the reporting machine:
          {desc.cliRemediation.map((cmd) => (
            <div key={cmd} className="text-[var(--color-text-dim)]">
              {"  "}
              {cmd}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] px-6 py-16 text-center">
      <p className="text-sm text-[var(--color-text-dim)]">No blocked events yet from this workspace.</p>
      <p className="mt-1 font-data text-xs text-[var(--color-text-faint)]">
        Run <span className="text-[var(--color-text)]">mcpseal login</span> on a protected machine to start shipping
        blocks here.
      </p>
    </div>
  );
}
