import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

/** AUTH_SECRET si fourni, sinon un secret généré une fois et gardé dans data/. */
export function getAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(DATA_DIR, "auth-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const secret = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
