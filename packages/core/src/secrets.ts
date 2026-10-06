// Secret patterns shared by the repo secret scan (scripts/secret-scan.mjs),
// the audit-log redactor, and the S10 tests. Keep this file import-free so
// Node can load it directly with type stripping.

export interface SecretPattern {
  id: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "openai-key", re: /sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { id: "github-token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { id: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: "aws-access-key", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: "private-key", re: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/g },
  { id: "generic-bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g },
];

export const REDACTED = "[REDACTED]";

/** Replaces every secret-pattern match with [REDACTED]. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, re.flags), REDACTED);
  return out;
}

/** Returns the ids of patterns that match. */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ re }) => new RegExp(re.source, re.flags.replace("g", "")).test(text)).map((p) => p.id);
}
