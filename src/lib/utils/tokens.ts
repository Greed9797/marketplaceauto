import { createHash, randomBytes } from "node:crypto";

export function createSecureToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
