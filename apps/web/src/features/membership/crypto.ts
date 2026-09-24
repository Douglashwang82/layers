import { createHash, randomBytes } from "node:crypto";
/** 160 bits of CSPRNG entropy, base64url so it is link- and copy/paste-safe. */
export function generateOpaqueToken() {
  return randomBytes(20).toString("base64url");
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
