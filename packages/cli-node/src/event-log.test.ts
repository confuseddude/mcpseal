import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendEvent, readEvents, recentBlocks } from "./event-log.js";

const dirs: string[] = [];
function tmpLogPath(): string {
  const d = mkdtempSync(path.join(tmpdir(), "mcplock-eventlog-test-"));
  dirs.push(d);
  return path.join(d, "nested", "events.jsonl"); // nested to prove mkdir -p behavior
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("appendEvent / readEvents (Part 3.4 / 4.2, Tasks.md 2.5)", () => {
  it("creates the log directory and appends a JSONL line", () => {
    const logPath = tmpLogPath();
    appendEvent({ type: "blocked_drift", server: "github", tool: "create_issue" }, logPath);
    expect(existsSync(logPath)).toBe(true);
    const raw = readFileSync(logPath, "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(1);
  });

  it("appends multiple events, one JSON object per line", () => {
    const logPath = tmpLogPath();
    appendEvent({ type: "blocked_denied", server: "github", tool: "delete_repo" }, logPath);
    appendEvent({ type: "blocked_drift", server: "github", tool: "create_issue" }, logPath);
    const events = readEvents(logPath);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("blocked_denied");
    expect(events[1].type).toBe("blocked_drift");
  });

  it("populates descriptionDiff only when both old and new descriptions are given", () => {
    const logPath = tmpLogPath();
    appendEvent(
      { type: "blocked_drift", server: "s", tool: "t", oldDescription: "safe", newDescription: "evil" },
      logPath
    );
    const [event] = readEvents(logPath);
    expect(event.descriptionDiff).toBe("- safe\n+ evil");
  });

  it("each event gets a unique eventId and an ISO timestamp", () => {
    const logPath = tmpLogPath();
    appendEvent({ type: "blocked_drift", server: "s", tool: "t" }, logPath);
    appendEvent({ type: "blocked_drift", server: "s", tool: "t" }, logPath);
    const [a, b] = readEvents(logPath);
    expect(a.eventId).not.toBe(b.eventId);
    expect(new Date(a.ts).toISOString()).toBe(a.ts);
  });

  it("readEvents returns an empty array when the log doesn't exist", () => {
    const logPath = tmpLogPath();
    expect(readEvents(logPath)).toEqual([]);
  });

  it("readEvents skips a corrupted line rather than failing the whole read", () => {
    const logPath = tmpLogPath();
    appendEvent({ type: "blocked_drift", server: "s", tool: "t" }, logPath);
    appendFileSync(logPath, "{ not valid json\n", "utf-8");
    appendEvent({ type: "blocked_denied", server: "s", tool: "t2" }, logPath);
    expect(readEvents(logPath)).toHaveLength(2);
  });
});

describe("recentBlocks", () => {
  it("filters to only blocked_* types and sorts newest first", () => {
    const events = [
      { eventId: "1", ts: "2026-08-17T00:00:00Z", type: "blocked_drift" as const, server: "s", tool: "a", clientApp: "x", mcplockVersion: "0.1.0" },
      { eventId: "2", ts: "2026-08-17T00:00:02Z", type: "approved" as const, server: "s", tool: "b", clientApp: "x", mcplockVersion: "0.1.0" },
      { eventId: "3", ts: "2026-08-17T00:00:01Z", type: "blocked_denied" as const, server: "s", tool: "c", clientApp: "x", mcplockVersion: "0.1.0" },
    ];
    const result = recentBlocks(events);
    expect(result.map((e) => e.eventId)).toEqual(["3", "1"]);
  });

  it("respects the limit", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      eventId: String(i),
      ts: `2026-08-17T00:00:0${i}Z`,
      type: "blocked_drift" as const,
      server: "s",
      tool: "t",
      clientApp: "x",
      mcplockVersion: "0.1.0",
    }));
    expect(recentBlocks(events, 2)).toHaveLength(2);
  });
});
