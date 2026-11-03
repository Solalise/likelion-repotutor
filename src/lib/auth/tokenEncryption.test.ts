import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./tokenEncryption";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("GitHub token encryption", () => {
  it("encrypts with AES-GCM and restores the original token", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptToken("github-secret-token");
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("github-secret-token");
    expect(decryptToken(encrypted)).toBe("github-secret-token");
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptToken("secret")).toThrow(/32바이트/);
  });
});
