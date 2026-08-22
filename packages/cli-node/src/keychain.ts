// build-bible.md Part 6.2 / CLAUDE.md invariant 6: "workspace API key...
// stored in the OS keychain — keytar on Node, keyring on Python, never a
// plaintext dotfile." keytar itself is unmaintained (archived); this uses
// @napi-rs/keyring, an actively maintained equivalent that wraps Windows
// Credential Manager / macOS Keychain / Linux Secret Service the same way.
//
// Fail closed: if the OS keychain is unavailable, secrets are never written
// to a fallback plaintext location. A login that can't reach the keychain
// must fail loudly, not silently degrade to a dotfile. Verified directly:
// on a headless Linux container with no Secret Service, setPassword throws
// and the value appears in no file on disk.
import { Entry } from "@napi-rs/keyring";

const SERVICE = "mcpseal";

// `new Entry()` is what talks to the platform store, so it throws on a
// machine with no keychain backend -- BEFORE any try block wrapping only
// the get/set/delete call. Every entry point below therefore constructs
// inside its own try. Getting this wrong made `mcpseal logout` exit 1
// with an opaque [UNKNOWN_ERROR] on any headless Linux box in 0.1.3.
function openEntry(account: string): Entry {
  return new Entry(SERVICE, account);
}

// True when the platform has no usable credential store at all, as
// opposed to the store being present but refusing this operation.
//
// @napi-rs/keyring has no stable error codes, so this matches its
// wording: "Couldn't access platform storage: PermissionDenied" is what a
// container with no Secret Service produces. Matching the *no backend*
// case (rather than trying to enumerate every failure) keeps the
// dangerous direction safe: anything unrecognised is still treated as a
// real failure by callers that care.
function isNoBackendError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /access platform storage|no such interface|not provided by any \.service|servicenotavailable|platformfailure/i.test(
    message
  );
}

export function setSecret(account: string, secret: string): void {
  // Deliberately unguarded: invariant 6 says a login that cannot reach the
  // keychain must fail loudly rather than degrade to a plaintext fallback.
  const entry = openEntry(account);
  entry.setPassword(secret);
}

export function getSecret(account: string): string | null {
  try {
    return openEntry(account).getPassword();
  } catch {
    // No entry, or no keychain backend at all. Both mean "no credential
    // available here", which is what callers check for -- normalize to
    // null so they can distinguish "not logged in" without catching
    // exceptions at every call site. Mirrors cli-python's get_secret(),
    // which collapses any KeyringError to None.
    return null;
  }
}

export function deleteSecret(account: string): void {
  try {
    openEntry(account).deletePassword();
  } catch (err) {
    // No backend at all (a headless Linux server, a CI container): nothing
    // could have been stored, because setSecret() fails loudly rather than
    // writing a fallback. Deletion is vacuously complete.
    if (isNoBackendError(err)) return;

    // A backend exists but the delete did not happen. The overwhelmingly
    // common case is "entry was already absent", which is idempotent and
    // fine. A locked or permission-refused keychain that DOES hold the
    // credential is not fine -- but @napi-rs/keyring reports both as
    // generic errors with no code to tell them apart, so this cannot be
    // distinguished here without guessing at message text.
    //
    // Resolved in favour of not crashing `logout`, and by making the
    // guarantee true at a different layer: callers verify the secret is
    // actually gone via getSecret() rather than trusting this to throw.
    // cli-python can be stricter because `keyring` gives it a typed
    // NoKeyringError; matching that here would mean pattern-matching
    // English error strings, which is how the 0.1.3 bug happened.
  }
}

// Confirms a credential is really gone after deleteSecret(), for callers
// that need the stronger guarantee (logout reporting success). Returns
// false if the secret is still readable, which is the case deleteSecret()
// cannot reliably detect on its own.
export function secretIsCleared(account: string): boolean {
  return getSecret(account) === null;
}
