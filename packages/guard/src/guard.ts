// The guard sits between any planner and any tool. It:
//  1. validates the planner's proposed call (shape only; the planner is untrusted),
//  2. resolves handle references ("$v3") into values and records taint itself,
//  3. derives paths and hosts from the tool spec, never from planner claims,
//  4. asks the policy engine, queues for human approval if needed,
//  5. executes only on allow, and audits every step.
import { z } from "zod";
import { HandleIdSchema, JsonSchema, ToolNameSchema } from "@play4m3/core";
import type { CapabilityManifest, HandleId, Json, PolicyDecision, ToolRequest } from "@play4m3/core";
import { PolicyEngine } from "@play4m3/core";
import type { HmacApprovalAuthority } from "./approvals.js";
import type { AuditLog } from "./audit.js";
import type { HandleStore } from "./handles.js";

/** What a planner may propose. Anything else is rejected before policy. */
export const PlannerCallSchema = z
  .object({
    tool: ToolNameSchema,
    args: z.record(z.string().max(64), JsonSchema),
  })
  .strict();
export type PlannerCall = z.infer<typeof PlannerCallSchema>;

export interface ToolSpec<A extends Record<string, Json> = Record<string, Json>> {
  name: string;
  description: string;
  args: z.ZodType<A>;
  /** Arg names whose (resolved) string values are workspace-relative paths. */
  pathArgs?: readonly string[];
  /** Arg names whose (resolved) string values are network hosts. */
  hostArgs?: readonly string[];
  run(args: A): Promise<Json> | Json;
}

export type GuardResult =
  | { status: "executed"; requestId: string; output: Json }
  | { status: "pending_approval"; requestId: string; request: ToolRequest }
  | { status: "denied"; requestId: string | null; rule: string; reason: string };

const MAX_DEPTH = 16;

export class Guard {
  private readonly policy: PolicyEngine;
  private readonly tools = new Map<string, ToolSpec>();
  private readonly pending = new Map<string, ToolRequest>();
  private seq = 0;

  constructor(
    manifest: CapabilityManifest,
    tools: readonly ToolSpec[],
    private readonly handles: HandleStore,
    private readonly approvals: HmacApprovalAuthority,
    private readonly audit: AuditLog,
  ) {
    this.policy = new PolicyEngine(manifest, approvals);
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Entry point for planner output. `raw` is untrusted. */
  async propose(raw: unknown): Promise<GuardResult> {
    const parsed = PlannerCallSchema.safeParse(raw);
    if (!parsed.success) return this.denied(null, "planner.malformed", "planner call failed schema validation", raw);
    const call = parsed.data;
    const requestId = `req_${++this.seq}`;
    this.audit.append("tool_call", { requestId, tool: call.tool, args: call.args });

    const spec = this.tools.get(call.tool);
    if (!spec) return this.denied(requestId, "tool.not-registered", `no implementation for ${call.tool}`);

    const taint = new Set<HandleId>();
    let resolved: Json;
    try {
      resolved = this.resolve(call.args, taint, 0);
    } catch (err) {
      return this.denied(requestId, "args.unresolvable", (err as Error).message);
    }
    const argsCheck = spec.args.safeParse(resolved);
    if (!argsCheck.success) return this.denied(requestId, "args.invalid", "arguments failed tool schema");
    const args = argsCheck.data as Record<string, Json>;

    const paths = (spec.pathArgs ?? []).map((k) => args[k]).filter((v): v is string => typeof v === "string");
    const net = (spec.hostArgs ?? []).map((k) => args[k]).filter((v): v is string => typeof v === "string");
    const request: ToolRequest = { id: requestId, tool: call.tool, args, paths, net, taintedBy: [...taint] };
    return this.decideAndRun(spec, request);
  }

  /**
   * Called ONLY by the trusted approval UI (main process) after a user gesture.
   * Never exposed as a tool, never reachable from model output.
   */
  async approve(requestId: string): Promise<GuardResult> {
    const request = this.pending.get(requestId);
    if (!request) return this.denied(requestId, "approval.unknown-request", "no pending request with that id");
    this.pending.delete(requestId);
    const spec = this.tools.get(request.tool);
    if (!spec) return this.denied(requestId, "tool.not-registered", "tool vanished");
    const token = this.approvals.issue(request);
    this.audit.append("approval", { requestId, by: "user" });
    return this.decideAndRun(spec, { ...request, approvalToken: token });
  }

  reject(requestId: string): void {
    if (this.pending.delete(requestId)) this.audit.append("approval", { requestId, by: "user", rejected: true });
  }

  pendingRequests(): readonly ToolRequest[] {
    return [...this.pending.values()];
  }

  private async decideAndRun(spec: ToolSpec, request: ToolRequest): Promise<GuardResult> {
    const decision: PolicyDecision = this.policy.evaluate(request);
    this.audit.append("decision", decisionRecord(request.id, decision));
    if (!decision.allow) {
      if (decision.rule === "approval.missing") {
        this.pending.set(request.id, request);
        return { status: "pending_approval", requestId: request.id, request };
      }
      return { status: "denied", requestId: request.id, rule: decision.rule, reason: decision.reason };
    }
    const output = await spec.run(request.args as never);
    this.audit.append("execution", { requestId: request.id, tool: request.tool });
    return { status: "executed", requestId: request.id, output };
  }

  /** Replaces exact-match handle strings ("$v3") with their values; records taint. */
  private resolve(value: Json, taint: Set<HandleId>, depth: number): Json {
    if (depth > MAX_DEPTH) throw new Error("arguments nested too deeply");
    if (typeof value === "string") {
      if (/^\$v\d+$/.test(value)) {
        const id = HandleIdSchema.parse(value);
        const entry = this.handles.get(id);
        if (!entry) throw new Error("reference to unknown handle");
        taint.add(id);
        return JsonSchema.parse(entry.labeled.value);
      }
      // A handle id embedded in a longer string is still a reference to untrusted data.
      for (const m of value.matchAll(/\$v\d+/g)) if (this.handles.has(m[0])) taint.add(m[0] as HandleId);
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => this.resolve(v, taint, depth + 1));
    if (value && typeof value === "object") {
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.resolve(v, taint, depth + 1);
      return out;
    }
    return value;
  }

  private denied(requestId: string | null, rule: string, reason: string, raw?: unknown): GuardResult {
    this.audit.append("decision", { requestId, allow: false, rule, reason, ...(raw === undefined ? {} : { rawType: typeof raw }) });
    return { status: "denied", requestId, rule, reason };
  }
}

function decisionRecord(requestId: string, d: PolicyDecision): Json {
  return d.allow ? { requestId, allow: true, reason: d.reason } : { requestId, allow: false, rule: d.rule, reason: d.reason };
}
