import { describe, it, expect, afterEach } from "vitest";
import { setSecret, getSecret, deleteSecret } from "./keychain.js";

const TEST_ACCOUNT = "test-account-mcplock-vitest";

describe("keychain", () => {
  afterEach(() => {
    deleteSecret(TEST_ACCOUNT);
  });

  it("round-trips a secret through the real OS keychain", () => {
    setSecret(TEST_ACCOUNT, "s3cr3t-value");
    expect(getSecret(TEST_ACCOUNT)).toBe("s3cr3t-value");
  });

  it("returns null for a secret that was never set", () => {
    expect(getSecret("account-that-does-not-exist-mcplock-vitest")).toBeNull();
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
