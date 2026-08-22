// build-bible.md Part 3.2, docs/Tasks.md 2.6: `mcpseal diff` — human-readable
// old-vs-new for any drifted tool. Can only text-diff descriptions, since
// that's the only pre-mutation state the lockfile stores (docs/Tasks.md 2.3
// Change Log deliberately chose description-only over storing the full
// {name,description,inputSchema} object). When the hash differs but the
// description text is identical, the change must be in inputSchema — flag
// that honestly rather than fabricate a schema diff we have no data for.
import { scan, type ScanDecision } from "./scan.js";

export interface DriftDiff {
  serverName: string;
  toolName: string;
  oldDescription: string;
  newDescription: string;
  descriptionChanged: boolean;
  possibleSchemaChange: boolean;
}

export async function diffDrifted(projectDir: string, lockfilePath?: string): Promise<DriftDiff[]> {
  const decisions: ScanDecision[] = await scan(projectDir, lockfilePath);
  return decisions
    .filter((d) => d.result.reason === "blocked_drift")
    .map((d) => {
      const oldDescription = d.result.oldDescription ?? "";
      const newDescription = d.result.newDescription ?? "";
      return {
        serverName: d.serverName,
        toolName: d.toolName,
        oldDescription,
        newDescription,
        descriptionChanged: oldDescription !== newDescription,
        possibleSchemaChange: oldDescription === newDescription,
      };
    });
}

export function formatDiff(diff: DriftDiff): string {
  const lines = [`${diff.serverName}/${diff.toolName}:`];
  if (diff.descriptionChanged) {
    lines.push(`  - ${diff.oldDescription}`);
    lines.push(`  + ${diff.newDescription}`);
  }
  if (diff.possibleSchemaChange) {
    lines.push(`  (description unchanged — the change is in inputSchema; full schema diff not available)`);
  }
  return lines.join("\n");
}
