export type ToolStatus = "approved" | "denied" | "quarantined";
export interface ToolEntry {
    hash: string;
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
