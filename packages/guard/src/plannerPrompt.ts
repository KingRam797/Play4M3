// S1: the only way to build planner input. Untrusted text cannot enter:
//  - user turns must carry a planner-visible trust label, else we throw;
//  - untrusted data appears only as handle descriptors (fixed vocabulary);
//  - tool descriptions come from first-party code, not from data.
import { isPlannerVisible } from "@play4m3/core";
import type { HandleId, Labeled } from "@play4m3/core";
import type { HandleDescriptor, HandleStore } from "./handles.js";

export interface PlannerToolDescriptor {
  name: string;
  description: string; // first-party text only
}

export interface PlannerInput {
  system: string;
  turns: Array<{ role: "user"; text: string; trust: "user_typed" | "user_voice_confirmed" }>;
  handles: HandleDescriptor[];
  tools: PlannerToolDescriptor[];
}

export class UntrustedInPlannerError extends Error {
  constructor() {
    super("refusing to put untrusted content into planner context");
    this.name = "UntrustedInPlannerError";
  }
}

const SYSTEM = [
  "You plan actions for a game-modding workbench.",
  "You never see file contents, decompiler output, or imported audio. You see opaque handles like $v3 instead.",
  "Refer to untrusted data only by handle id. Propose tool calls as JSON. A deterministic policy engine and the user decide what runs.",
].join(" ");

export function buildPlannerInput(opts: {
  userTurns: Array<Labeled<string>>;
  handles: HandleStore;
  visibleHandles: HandleId[];
  tools: PlannerToolDescriptor[];
}): PlannerInput {
  const turns = opts.userTurns.map((t) => {
    if (!isPlannerVisible(t.trust) || typeof t.value !== "string") throw new UntrustedInPlannerError();
    return { role: "user" as const, text: t.value, trust: t.trust as "user_typed" | "user_voice_confirmed" };
  });
  const handles = opts.visibleHandles.map((id) => opts.handles.describe(id));
  return { system: SYSTEM, turns, handles, tools: opts.tools.map((t) => ({ name: t.name, description: t.description })) };
}

/** Serialized form actually sent to a provider. Tests assert over this string. */
export function serializePlannerInput(input: PlannerInput): string {
  return JSON.stringify(input);
}
