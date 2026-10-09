import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function encryptSecret(key: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const content = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
}
export function decryptSecret(key: string, encrypted: string): string {
  const data = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
