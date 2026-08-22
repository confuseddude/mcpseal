import { describe, it, expect, afterEach } from "vitest";
import { setSecret, getSecret, deleteSecret, secretIsCleared } from "./keychain.js";

const TEST_ACCOUNT = "test-account-mcpseal-vitest";

describe("keychain", () => {
  afterEach(() => {
    deleteSecret(TEST_ACCOUNT);
  });

  it("round-trips a secret through the real OS keychain", () => {
    setSecret(TEST_ACCOUNT, "s3cr3t-value");
    expect(getSecret(TEST_ACCOUNT)).toBe("s3cr3t-value");
  });

  it("returns null for a secret that was never set", () => {
    expect(getSecret("account-that-does-not-exist-mcpseal-vitest")).toBeNull();
  });

  it("delete is idempotent and getSecret returns null after delete", () => {
    setSecret(TEST_ACCOUNT, "temp");
    deleteSecret(TEST_ACCOUNT);
    expect(getSecret(TEST_ACCOUNT)).toBeNull();
    expect(() => deleteSecret(TEST_ACCOUNT)).not.toThrow();
  });

  it("overwriting a secret replaces the old value", () => {
    setSecret(TEST_ACCOUNT, "first");
    setSecret(TEST_ACCOUNT, "second");
    expect(getSecret(TEST_ACCOUNT)).toBe("second");
  });
});

// Regression: `mcpseal logout` exited 1 with an opaque [UNKNOWN_ERROR] on
// any machine with no keychain backend (headless Linux, a container),
// because `new Entry()` -- which is what actually talks to the platform
// store -- sat OUTSIDE the try block. The catch never ran. Shipped in
// 0.1.3; the identical bug had already been fixed in cli-python, so this
// was a cross-language parity miss.
//
// The real no-backend path can only be exercised on a machine without a
// keychain, which CI is not (GitHub runners have a working Secret
// Service). These assert the structural property instead: nothing here
// may throw for a caller who is simply not logged in.
describe("no keychain backend (regression: logout crashed on headless Linux)", () => {
  const ABSENT = "account-definitely-not-present-mcpseal-vitest";

  it("getSecret returns null rather than throwing", () => {
    expect(() => getSecret(ABSENT)).not.toThrow();
    expect(getSecret(ABSENT)).toBeNull();
  });

  it("deleteSecret on an absent account never throws", () => {
    expect(() => deleteSecret(ABSENT)).not.toThrow();
  });

  it("deleteSecret is safe to call repeatedly", () => {
    expect(() => {
      deleteSecret(ABSENT);
      deleteSecret(ABSENT);
      deleteSecret(ABSENT);
    }).not.toThrow();
  });

  it("secretIsCleared reports true once nothing is stored", () => {
    deleteSecret(ABSENT);
    expect(secretIsCleared(ABSENT)).toBe(true);
  });
});
