import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1";

function encryptionKey(): Buffer {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("TOKEN_ENCRYPTION_KEY 환경변수가 필요합니다.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY는 base64로 인코딩한 32바이트 키여야 합니다.");
  return key;
}

export function encryptToken(value: string | null | undefined): string | null | undefined {
  if (!value || value.startsWith(`${PREFIX}:`)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(`${PREFIX}:`)) {
    if (process.env.NODE_ENV !== "production") return value;
    throw new Error("암호화되지 않은 GitHub 토큰을 사용할 수 없습니다.");
  }
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("저장된 GitHub 토큰 형식이 올바르지 않습니다.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
