// build-bible.md Part 6.1: "The provider authenticates *who* they are;
// your App API authorizes *what* they can do — never trust the client for
// authorization." Every role check in this file runs server-side against
// the session-derived user, never against anything the client sends.
import type { Role } from "./db.js";

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function hasAtLeastRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
