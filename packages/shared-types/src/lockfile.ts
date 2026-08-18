// Matches build-bible.md Part 2.3 exactly.

export type ToolStatus = "approved" | "denied" | "quarantined";

export interface ToolEntry {
  hash: string;
  // The tool's last-approved description text. Stored alongside the hash
  // (which is not reversible) so drift detection can show an actual old-vs-
  // new description diff (Part 2.4) rather than just two opaque hashes.
  description: string;
  approvedAt: string;
  approvedBy: string;
  status: ToolStatus;
}

export interface ServerEntry {
  transport: string;
  command: string;
  args: string[];
  commandHash: string;
  tools: Record<string, ToolEntry>;
}

export interface Policy {
  onDrift: string;
  onUnknownTool: string;
  allowNewToolsFromApprovedServer: boolean;
}

export interface Lockfile {
  version: number;
  generatedAt: string;
  generatedBy: string;
  servers: Record<string, ServerEntry>;
  policy: Policy;
  signature: string | null;
}
