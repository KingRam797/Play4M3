// S14: tamper-evident audit log. Each entry's hash covers its content and the
// previous entry's hash, so editing, deleting, reordering or inserting any
// entry breaks verification from that point on. Secrets are redacted before
// an entry is hashed, so redaction never breaks the chain.
import { redactSecrets } from "@play4m3/core";
import type { Json } from "@play4m3/core";
import { canonicalJson, sha256Hex } from "./canonicalJson.js";

export const AUDIT_KINDS = ["model_call", "tool_call", "decision", "approval", "execution", "session"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export interface AuditEntry {
  seq: number;
  ts: string;
  kind: AuditKind;
  data: Json;
  prev: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

function redactJson(value: Json): Json {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[redactSecrets(k)] = redactJson(v);
    return out;
  }
  return value;
}

function entryHash(e: Omit<AuditEntry, "hash">): string {
  return sha256Hex(canonicalJson({ seq: e.seq, ts: e.ts, kind: e.kind, data: e.data, prev: e.prev }));
}

export interface AuditSink {
  write(entry: AuditEntry): void;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(
    private readonly sink?: AuditSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(kind: AuditKind, data: Json): AuditEntry {
    const prevEntry = this.entries[this.entries.length - 1];
    const base = { seq: this.entries.length, ts: this.now().toISOString(), kind, data: redactJson(data), prev: prevEntry ? prevEntry.hash : GENESIS };
    const entry: AuditEntry = Object.freeze({ ...base, hash: entryHash(base) });
    this.entries.push(entry);
    this.sink?.write(entry);
    return entry;
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }

  head(): string {
    return this.entries[this.entries.length - 1]?.hash ?? GENESIS;
  }
}

export type ChainCheck = { ok: true; head: string } | { ok: false; at: number; reason: string };

/**
 * Verifies a full log, e.g. one re-read from disk. Pass `expectedHead` (an
 * anchor kept outside the log file) to also detect truncation of the tail,
 * which a hash chain alone cannot see.
 */
export function verifyChain(entries: readonly AuditEntry[], expectedHead?: string): ChainCheck {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as AuditEntry;
    if (e.seq !== i) return { ok: false, at: i, reason: "sequence gap or reorder" };
    if (e.prev !== prev) return { ok: false, at: i, reason: "prev hash mismatch" };
    if (entryHash(e) !== e.hash) return { ok: false, at: i, reason: "entry hash mismatch" };
    prev = e.hash;
  }
  if (expectedHead !== undefined && expectedHead !== prev) return { ok: false, at: entries.length, reason: "head does not match anchor (truncated?)" };
  return { ok: true, head: prev };
}
