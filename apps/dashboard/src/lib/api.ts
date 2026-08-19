// build-bible.md Part 7.1: "Talk to the App API... the dashboard never
// calls the Event Store or Postgres directly" — this is the ONLY place in
// the dashboard that makes network requests, and it always goes to the
// App API, never to ingest or a database.
const APP_API_URL = process.env.NEXT_PUBLIC_APP_API_URL ?? "http://127.0.0.1:8789";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${APP_API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member" | "viewer";
}

export interface McpsealEventRow {
  event_id: string;
  workspace_id: string;
  machine_id: string;
  ts: string;
  type: string;
  server: string;
  tool: string;
  observed_hash: string | null;
  expected_hash: string | null;
  description_diff: string | null;
  client_app: string;
  severity: string;
}

export interface MachineRow {
  id: string;
  machine_id: string;
  workspace_id: string;
  first_seen: string;
  last_seen: string;
  mcpseal_version: string | null;
}

export interface PolicyRow {
  id: string;
  orgId: string;
  version: number;
  lockfileJson: string;
  signature: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ApiKeyRow {
  id: string;
  key_id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  last_used: string | null;
  revoked_at: string | null;
}

export interface Subscription {
  plan: "free" | "team" | "enterprise";
  seats: number;
  status: string;
}

export const api = {
  me: () => request<{ user: Me }>("/v1/auth/me"),
  devLogin: (email: string) => request<{ user: Me }>("/v1/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
  logout: () => request<{ ok: true }>("/v1/auth/logout", { method: "POST" }),
  members: () => request<{ members: Me[] }>("/v1/members"),
  setRole: (userId: string, role: Me["role"]) =>
    request<{ ok: true }>(`/v1/members/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
  events: (limit = 100) => request<{ events: McpsealEventRow[] }>(`/v1/events?limit=${limit}`),
  machines: () => request<{ machines: MachineRow[] }>("/v1/machines"),
  policies: () => request<{ policies: PolicyRow[] }>("/v1/policies"),
  createPolicy: (lockfileJson: string) => request<{ policy: PolicyRow }>("/v1/policies", { method: "POST", body: JSON.stringify({ lockfileJson }) }),
  policySigningKey: () => request<{ publicKey: string }>("/v1/policy/signing-key"),
  apiKeys: () => request<{ apiKeys: ApiKeyRow[] }>("/v1/api-keys"),
  revokeApiKey: (keyId: string) => request<{ ok: true }>(`/v1/api-keys/${keyId}`, { method: "DELETE" }),
  subscription: () => request<{ subscription: Subscription }>("/v1/billing/subscription"),
  checkout: (returnUrl: string) =>
    request<{ url: string; mode: "stripe" | "mock" }>("/v1/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "team", successUrl: returnUrl, cancelUrl: returnUrl }),
    }),
  billingPortal: (returnUrl: string) =>
    request<{ url: string }>("/v1/billing/portal", { method: "POST", body: JSON.stringify({ returnUrl }) }),
  connectMachine: (userCode: string) =>
    request<{ approved: true; workspaceId: string }>("/v1/machines/connect", { method: "POST", body: JSON.stringify({ userCode }) }),
  auditExport: () =>
    request<{
      events: Array<{ eventId: string; workspaceId: string; type: string; server: string; tool: string; chainHash: string; ts: string }>;
      verification: Record<string, { valid: boolean; eventCount: number }>;
    }>("/v1/audit/export"),
};
