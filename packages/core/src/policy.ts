// Deterministic policy engine (brief §4.2). No LLM, no I/O, default deny.
// Every tool call passes through evaluate() before execution, whatever the
// planner says. S4 depends on this: a fully compromised planner still cannot
// execute anything the capability manifest and the user did not allow.
import { canonicalizeRelative, isWithinScope } from "./paths.js";
import { CapabilityManifestSchema, HostSchema, ToolRequestSchema } from "./types.js";
import type { Capability, CapabilityManifest, Decision, ToolRequest } from "./types.js";

/**
 * Verifies that a human approved this exact request. Implemented in
 * @play4m3/guard (HMAC, single use, bound to the request digest). The key
 * lives outside model context and outside the renderer.
 */
export interface ApprovalVerifier {
  verify(token: string, request: ToolRequest): boolean;
}

export type PolicyDecision = Decision & { request?: ToolRequest; canonicalPaths?: string[] };

function deny(rule: string, reason: string): PolicyDecision {
  return { allow: false, rule, reason };
}

export class PolicyEngine {
  private readonly caps: ReadonlyMap<string, Capability>;

  constructor(
    manifest: CapabilityManifest,
    private readonly approvals: ApprovalVerifier,
  ) {
    const parsed = CapabilityManifestSchema.parse(manifest);
    this.caps = new Map(parsed.map((c) => [c.tool, Object.freeze({ ...c })]));
  }

  evaluate(input: unknown): PolicyDecision {
    // 0. Shape. A compromised planner can send anything; only a strict ToolRequest gets further.
    const parsed = ToolRequestSchema.safeParse(input);
    if (!parsed.success) return deny("request.malformed", "request failed schema validation");
    const req = parsed.data;

    // 1. Tool allowlist.
    const cap = this.caps.get(req.tool);
    if (!cap) return deny("tool.not-allowlisted", `tool ${req.tool} is not in the capability manifest`);

    // 2. Paths: canonical, inside an explicit scope.
    const canonicalPaths: string[] = [];
    if (req.paths.length > 0) {
      if (!cap.pathScope || cap.pathScope.length === 0) return deny("path.no-scope", `${req.tool} has no path scope`);
      for (const p of req.paths) {
        const c = canonicalizeRelative(p);
        if (!c.ok) return deny(c.rule, c.reason);
        if (!cap.pathScope.some((scope) => isWithinScope(c.path, scope))) return deny("path.out-of-scope", `path outside ${req.tool} scope`);
        canonicalPaths.push(c.path);
      }
    }

    // 3. Network: denied unless the capability allowlists the exact host.
    if (req.net.length > 0) {
      if (cap.net === "deny") return deny("net.denied", `${req.tool} has no network capability`);
      // 3a. Untrusted data never chooses a network destination.
      if (req.taintedBy.length > 0) return deny("net.tainted", "network target derived from untrusted data");
      const allow = new Set(cap.netAllow ?? []);
      for (const host of req.net) {
        if (!HostSchema.safeParse(host).success) return deny("net.bad-host", "host is not a plain lowercase ASCII name");
        if (!allow.has(host)) return deny("net.not-allowlisted", `host ${host} not allowlisted`);
      }
    }

    // 4. Approval. Required by the capability, or by any untrusted-derived argument.
    const needsApproval = cap.approval === "user" || req.taintedBy.length > 0;
    if (needsApproval) {
      if (!req.approvalToken) return deny("approval.missing", "user approval required");
      if (!this.approvals.verify(req.approvalToken, req)) return deny("approval.invalid", "approval token invalid, expired, reused, or for a different request");
    }

    return { allow: true, reason: needsApproval ? "allowed with user approval" : "allowed by capability", request: req, canonicalPaths };
  }
}

/** Verifier that rejects everything. Use where no approval UI exists (e.g. web build). */
export const DENY_ALL_APPROVALS: ApprovalVerifier = { verify: () => false };
