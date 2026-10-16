/**
 * 應用層 token 加密（09 §Token 儲存、D10）：AES-256-GCM，金鑰 TOKEN_ENCRYPTION_KEY。
 * 格式 `v1.<iv>.<tag>.<ciphertext>`（皆 base64url）。同一個工具也給 calendar_feeds.tokenCiphertext 用（只實作一次）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export interface TokenCipher {
  encrypt(plain: string): string;
  decrypt(cipherText: string): string;
  isEncrypted(value: string): boolean;
}

export function createTokenCipher(key: Buffer): TokenCipher {
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY 必須是 32 bytes");
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    },
    decrypt(cipherText) {
      const [v, iv, tag, ct] = cipherText.split(".");
      if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error("無法辨識的密文格式");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    },
    isEncrypted(value) {
      return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
    },
  };
}
