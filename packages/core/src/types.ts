import { z } from "zod";
import { canonicalizeRelative } from "./paths.js";

// ---- Brief §4.1, exact shape ------------------------------------------------

export type Trust = "user_typed" | "user_voice_confirmed" | "untrusted";

export interface Labeled<T> {
  value: T;
  trust: Trust;
  source: string; // e.g. "decompiler:ghidra", "file:README.md", "audio:import"
  sha256?: string;
}

export interface Capability {
  tool: string; // e.g. "fs.write", "analysis.run", "net.fetch"
  pathScope?: string[]; // resolved, canonical, workspace-relative only
  net: "deny" | "allowlist";
  netAllow?: string[];
  approval: "none" | "user"; // writes, exec, network, skill changes => "user"
}

export type Decision =
  | { allow: true; reason: string }
  | { allow: false; reason: string; rule: string };

// ---- Extensions ---------------------------------------------------------------

export const TRUST_LEVELS = ["user_typed", "user_voice_confirmed", "untrusted"] as const satisfies readonly Trust[];

/** Content the planner is allowed to read as text. Everything else is a handle. */
export function isPlannerVisible(trust: Trust): boolean {
  return trust === "user_typed" || trust === "user_voice_confirmed";
}

export const TrustSchema = z.enum(TRUST_LEVELS);

const TOOL_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const ToolNameSchema = z.string().max(64).regex(TOOL_NAME);
/** ASCII-only lowercase host names. Rejects IDN/homoglyph hosts by construction. */
export const HostSchema = z.string().regex(HOST_NAME);

export const CapabilitySchema = z
  .object({
    tool: ToolNameSchema,
    pathScope: z.array(z.string().min(1).max(512)).max(32).optional(),
    net: z.enum(["deny", "allowlist"]),
    netAllow: z.array(HostSchema).max(32).optional(),
    approval: z.enum(["none", "user"]),
  })
  .strict();

/**
 * Tool families that always need a human click (brief §4.1 comment, S3).
 * A manifest that marks one of these approval:"none" is rejected at load time.
 */
export const SENSITIVE_TOOL_PREFIXES = ["fs.write", "fs.delete", "fs.move", "exec.", "analysis.run", "net.", "skill.", "patch.export", "patch.write"] as const;

export function isSensitiveTool(tool: string): boolean {
  return SENSITIVE_TOOL_PREFIXES.some((p) => (p.endsWith(".") ? tool.startsWith(p) : tool === p || tool.startsWith(`${p}.`)));
}

export const CapabilityManifestSchema = z
  .array(CapabilitySchema)
  .max(64)
  .superRefine((caps, ctx) => {
    const seen = new Set<string>();
    caps.forEach((cap, i) => {
      if (seen.has(cap.tool)) ctx.addIssue({ code: "custom", path: [i, "tool"], message: `duplicate capability ${cap.tool}` });
      seen.add(cap.tool);
      if (isSensitiveTool(cap.tool) && cap.approval !== "user") {
        ctx.addIssue({ code: "custom", path: [i, "approval"], message: `${cap.tool} is sensitive and must require user approval` });
      }
      if (cap.net === "allowlist" && cap.approval !== "user") {
        ctx.addIssue({ code: "custom", path: [i, "approval"], message: "network capabilities must require user approval" });
      }
      if (cap.net === "allowlist" && (!cap.netAllow || cap.netAllow.length === 0)) {
        ctx.addIssue({ code: "custom", path: [i, "netAllow"], message: "allowlist with no hosts" });
      }
      cap.pathScope?.forEach((scope, j) => {
        const c = canonicalizeRelative(scope);
        if (!c.ok || c.path !== scope) ctx.addIssue({ code: "custom", path: [i, "pathScope", j], message: "pathScope entries must already be canonical workspace-relative paths" });
      });
      if (cap.net === "deny" && cap.netAllow && cap.netAllow.length > 0) {
        ctx.addIssue({ code: "custom", path: [i, "netAllow"], message: "netAllow given but net is deny" });
      }
    });
  });

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;

/** Opaque handle to an untrusted value, e.g. "$v12". The planner only ever sees these. */
export type HandleId = `$v${number}`;
export const HandleIdSchema = z.string().regex(/^\$v\d{1,9}$/) as unknown as z.ZodType<HandleId>;

/** JSON values only. No functions, no class instances, bounded depth enforced by the guard. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string().max(65536), z.number().finite(), z.boolean(), z.null(), z.array(JsonSchema).max(1024), z.record(z.string().max(128), JsonSchema)]),
);

/**
 * A tool call after the guard has resolved handles. `taintedBy` is computed by the
 * guard from the handles referenced in the planner's arguments; it is never
 * taken from the planner's own claims.
 */
export const ToolRequestSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    tool: ToolNameSchema,
    args: z.record(z.string().max(64), JsonSchema),
    paths: z.array(z.string().max(1024)).max(64),
    net: z.array(z.string().max(253)).max(16),
    taintedBy: z.array(HandleIdSchema).max(256),
    approvalToken: z.string().max(1024).optional(),
  })
  .strict();

export type ToolRequest = z.infer<typeof ToolRequestSchema>;
