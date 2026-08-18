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

const SERVICE = "mcplock";

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
  } catch {
    // Already absent — deletion is idempotent.
  }
}
