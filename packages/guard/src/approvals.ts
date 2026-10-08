// S3: approval tokens. Issued only by trusted UI code in the main process after
// a human click on the exact request; verified by the policy engine.
// Token = base64url(nonce).expiry.hmac(key, nonce|expiry|digest(request)).
// Single use; expires; any change to tool, args, paths, hosts or taint
// invalidates it. The key never leaves this object.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApprovalVerifier, ToolRequest } from "@play4m3/core";
import { canonicalJson, sha256Hex } from "./canonicalJson.js";

export function requestDigest(req: ToolRequest): string {
  const { approvalToken: _ignored, ...rest } = req;
  void _ignored;
  return sha256Hex(canonicalJson(rest));
}

export interface ApprovalAuthorityOptions {
  ttlMs?: number;
  now?: () => number;
}

export class HmacApprovalAuthority implements ApprovalVerifier {
  readonly #key: Buffer = randomBytes(32);
  readonly #used = new Set<string>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(opts: ApprovalAuthorityOptions = {}) {
    this.#ttlMs = opts.ttlMs ?? 2 * 60 * 1000;
    this.#now = opts.now ?? Date.now;
  }

  /** Call ONLY from the trusted approval UI handler, after a user gesture. */
  issue(req: ToolRequest): string {
    const nonce = randomBytes(16).toString("base64url");
    const expiry = this.#now() + this.#ttlMs;
    return `${nonce}.${expiry}.${this.#mac(nonce, expiry, requestDigest(req))}`;
  }

  verify(token: string, req: ToolRequest): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [nonce, expiryText, mac] = parts as [string, string, string];
    if (!/^[A-Za-z0-9_-]{22}$/.test(nonce) || !/^\d{1,15}$/.test(expiryText) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return false;
    const expiry = Number(expiryText);
    if (this.#now() > expiry) return false;
    if (this.#used.has(nonce)) return false;
    const expected = Buffer.from(this.#mac(nonce, expiry, requestDigest(req)), "utf8");
    const got = Buffer.from(mac, "utf8");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
    this.#used.add(nonce);
    return true;
  }

  #mac(nonce: string, expiry: number, digest: string): string {
    return createHmac("sha256", this.#key).update(`${nonce}|${expiry}|${digest}`).digest("base64url");
  }
}
