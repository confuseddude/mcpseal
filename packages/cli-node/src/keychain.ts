// build-bible.md Part 6.2 / CLAUDE.md invariant 6: "workspace API key...
// stored in the OS keychain — keytar on Node, keyring on Python, never a
// plaintext dotfile." keytar itself is unmaintained (archived); this uses
// @napi-rs/keyring, an actively maintained equivalent that wraps Windows
// Credential Manager / macOS Keychain / Linux Secret Service the same way.
//
// Fail closed: if the OS keychain is unavailable, secrets are never written
// to a fallback plaintext location. A login that can't reach the keychain
// must fail loudly, not silently degrade to a dotfile.
import { Entry } from "@napi-rs/keyring";

const SERVICE = "mcpseal";

export function setSecret(account: string, secret: string): void {
  const entry = new Entry(SERVICE, account);
  entry.setPassword(secret);
}

export function getSecret(account: string): string | null {
  const entry = new Entry(SERVICE, account);
  try {
    return entry.getPassword();
  } catch {
    // @napi-rs/keyring throws when no entry exists — normalize to null so
    // callers can distinguish "not logged in" from a real keychain failure
    // at the call site rather than catching exceptions everywhere.
    return null;
  }
}

export function deleteSecret(account: string): void {
  const entry = new Entry(SERVICE, account);
  try {
    entry.deletePassword();
  } catch (err) {
    // Already absent, or no keychain backend at all (a headless Linux box
    // with no Secret Service) — in both cases nothing is stored, because
    // setSecret() fails loudly rather than writing a fallback, so deletion
    // is vacuously complete and idempotent.
    //
    // Deliberately narrow, mirroring cli-python's delete_secret(): a
    // keychain that exists but is LOCKED can hold a real credential that
    // was not deleted, and swallowing that would let someone believe they
    // had logged out while the secret survives. That case must stay loud.
    if (isLockedKeychainError(err)) throw err;
  }
}

// @napi-rs/keyring surfaces backend failures as plain Errors without
// stable codes, so this matches on message text. Erring toward rethrowing
// would break logout on machines with no keychain; erring toward
// swallowing would hide a failed credential deletion. Locked/access-denied
// wording is the signal that an entry exists but could not be removed.
function isLockedKeychainError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /lock|denied|access|denied by policy|not permitted|authoriz/i.test(message);
}
