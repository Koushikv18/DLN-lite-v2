// ─────────────────────────────────────────────────────────────────────────────
// tests/backend/encryptionKey.test.js
// The key that protects users' Fabric private keys must never silently fall
// back to a value that anyone reading the repository knows.
// ─────────────────────────────────────────────────────────────────────────────

const { resolveEncryptionKey } = require("../../backend/utils/encryptionKey");

const GOOD_KEY = "a".repeat(64);

describe("resolveEncryptionKey", () => {
  it("uses ENCRYPTION_KEY when it is a valid 64-char hex string", () => {
    const warn = jest.fn();
    expect(resolveEncryptionKey({ ENCRYPTION_KEY: GOOD_KEY, NODE_ENV: "production" }, warn)).toBe(GOOD_KEY);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects a key of the wrong length or format", () => {
    expect(() => resolveEncryptionKey({ ENCRYPTION_KEY: "too-short" })).toThrow(/64 hex/);
    expect(() => resolveEncryptionKey({ ENCRYPTION_KEY: "z".repeat(64) })).toThrow(/64 hex/);
  });

  it("refuses to start in production without a key", () => {
    expect(() => resolveEncryptionKey({ NODE_ENV: "production" })).toThrow(/must be set in production/);
  });

  it("allows a development fallback, but warns loudly", () => {
    const warn = jest.fn();
    const key = resolveEncryptionKey({ NODE_ENV: "development" }, warn);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("INSECURE"));
  });
});
