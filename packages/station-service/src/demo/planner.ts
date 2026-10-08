// Demo planner: a deterministic stand-in for the real planner models (F9).
// It gets exactly what a real planner gets, a PlannerInput (S1: the user's
// own words plus opaque handles), and proposes tool calls. It never sees
// game text, so it can only point at data by handle id.
import type { PlannerCall, PlannerInput } from "@play4m3/guard";

export interface PlanResult {
  calls: PlannerCall[];
  reply: string;
}

export interface Planner {
  readonly name: string;
  plan(input: PlannerInput): PlanResult;
}

/** The tuning values the demo planner knows how to ask for. */
export const DEMO_PARAMS = {
  jump_velocity: /\bjump(s|ing)?\b/,
  gravity: /\bgravity\b/,
  run_speed: /\b(speed|run|running|faster|slower|walk)\b/,
} as const;
export type DemoParam = keyof typeof DEMO_PARAMS;

function factorFor(text: string): number | null {
  if (/\bdouble\b/.test(text)) return 2;
  if (/\bhalf|halve\b/.test(text)) return 0.5;
  if (/\b(higher|more|faster|increase|stronger|bigger|boost|up)\b/.test(text)) return 1.25;
  if (/\b(lower|less|slower|decrease|weaker|smaller|reduce|down)\b/.test(text)) return 0.8;
  return null;
}

export const HELP =
  "In this demo I can change one tuning value at a time. Pick a physics function, then try: make the jump higher, lower the gravity, or run faster.";

export class DemoPlanner implements Planner {
  readonly name = "demo-planner";

  plan(input: PlannerInput): PlanResult {
    const last = input.turns[input.turns.length - 1];
    if (!last) return { calls: [], reply: HELP };
    const text = last.text.toLowerCase();
    const param = (Object.keys(DEMO_PARAMS) as DemoParam[]).find((p) => DEMO_PARAMS[p].test(text));
    const factor = factorFor(text);
    if (!param || factor === null) return { calls: [], reply: HELP };

    const summary = [...input.handles].reverse().find((h) => h.valueKind === "function_summary");
    if (!summary) return { calls: [], reply: "Pick a function in the list first, so I know which code you mean." };

    const path = `mods/${param.replace(/_/g, "-")}-x${factor}.p4m3patch.json`;
    return {
      calls: [{ tool: "patch.write", args: { summary: summary.id, change: { tunable: param, factor }, path } }],
      reply: `I prepared a patch that sets ${param} to ${factor} times its current value. It is waiting for your approval.`,
    };
  }
}
