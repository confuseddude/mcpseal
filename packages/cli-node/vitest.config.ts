import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // login/keychain/machine-identity/ship-events tests all touch the same
    // real OS keychain entries (there's no in-process fake — the whole
    // point is testing against the actual Credential Manager/Keychain/
    // Secret Service). Running test files in parallel races those shared
    // entries against each other; force sequential execution instead.
    fileParallelism: false,
  },
});
