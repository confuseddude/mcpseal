// build-bible.md Part 3.4/4.2: "The event log is what gets *optionally*
// shipped to the Control Plane if the user joins a workspace — same
// records, different destination."
//
// CLAUDE.md invariant 2 is enforced structurally here, not just by
// intent: shipEvents() reads isLoggedIn() FIRST and returns before doing
// anything else — including before requiring fetch — if there's no config.
// No credentials, no config, no call. Tested explicitly in
// ship-events.test.ts by making fetchImpl throw if invoked at all.
import { readConfig, writeConfig, configPath as defaultConfigPath } from "./config.js";
import { getSecret } from "./keychain.js";
import { API_KEY_ACCOUNT } from "./login.js";
import { signWithMachineKey } from "./machine-identity.js";
import { readEvents, eventsLogPath, type McpsealEvent } from "./event-log.js";

const PRIVATE_KEY_ACCOUNT = "machine-private-key";
const MAX_BATCH_SIZE = 500;

export interface ShipOptions {
  logPath?: string;
  cfgPath?: string;
  fetchImpl?: typeof fetch;
}

export type ShipResult = { skipped: true; reason: string } | { skipped: false; shipped: number; duplicates: number };

export async function shipEvents(opts: ShipOptions = {}): Promise<ShipResult> {
  const cfgPath = opts.cfgPath ?? defaultConfigPath();
  const config = readConfig(cfgPath);
  if (!config?.workspaceId || !config?.machineId) {
    return { skipped: true, reason: "not logged in" };
  }

  const apiKeyToken = getSecret(API_KEY_ACCOUNT);
  const privateKeyHex = getSecret(PRIVATE_KEY_ACCOUNT);
  if (!apiKeyToken || !privateKeyHex) {
    return { skipped: true, reason: "missing credentials in keychain" };
  }

  const logPath = opts.logPath ?? eventsLogPath();
  const allEvents = readEvents(logPath);
  const unshipped = config.lastShippedEventId
    ? allEvents.slice(indexAfter(allEvents, config.lastShippedEventId))
    : allEvents;

  if (unshipped.length === 0) {
    return { skipped: false, shipped: 0, duplicates: 0 };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let shippedTotal = 0;
  let duplicateTotal = 0;

  for (let i = 0; i < unshipped.length; i += MAX_BATCH_SIZE) {
    const batch = unshipped.slice(i, i + MAX_BATCH_SIZE);
    const body = { machineId: config.machineId, workspaceId: config.workspaceId, batch };
    const raw = JSON.stringify(body);
    const signature = signWithMachineKey(privateKeyHex, Buffer.from(raw, "utf-8"));

    try {
      const res = await fetchImpl(`${config.ingestUrl}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKeyToken}`,
          "x-mcpseal-signature": signature,
        },
        body: raw,
      });
      if (!res.ok) {
        // Leave the cursor where it is; the next call retries this same
        // batch. A shipping failure must never surface as a CLI error —
        // it's best-effort, same as local event logging.
        break;
      }
      const result = (await res.json()) as { accepted: number; duplicates: number };
      shippedTotal += result.accepted;
      duplicateTotal += result.duplicates;

      const lastEvent = batch[batch.length - 1];
      writeConfig({ ...config, lastShippedEventId: lastEvent.eventId }, cfgPath);
      config.lastShippedEventId = lastEvent.eventId;
    } catch {
      break;
    }
  }

  return { skipped: false, shipped: shippedTotal, duplicates: duplicateTotal };
}

function indexAfter(events: McpsealEvent[], lastShippedEventId: string): number {
  const idx = events.findIndex((e) => e.eventId === lastShippedEventId);
  return idx === -1 ? 0 : idx + 1;
}

// Fire-and-forget helper for call sites (e.g. the proxy's block handler)
// that must never let a shipping failure — or shipping itself — block or
// slow down the actual proxy decision.
export function shipEventsBestEffort(opts: ShipOptions = {}): void {
  shipEvents(opts).catch(() => {
    // Intentionally swallowed — see module comment.
  });
}
