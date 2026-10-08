// Where a project's function list comes from: the demo fixture, or a real
// analyzer report (F4, ghidra-headless). Both are untrusted game data and are
// stored behind handles as soon as a project opens.
import { createHash } from "node:crypto";
import type { AnalysisReport } from "@play4m3/analysis";
import { TunableSchema } from "@play4m3/station-protocol";
import type { Tunable } from "@play4m3/station-protocol";
import { DEMO_FUNCTIONS, DEMO_GAME } from "./demo/sample.js";
import type { AnalyzedFunction } from "./demo/sample.js";

export type AnalysisSource = "demo" | "ghidra";

export interface GameAnalysis {
  source: AnalysisSource;
  game: { title: string; sha256: string; sizeBytes: number };
  functions: readonly AnalyzedFunction[];
}

/** The ViewState can hold this many functions. */
export const MAX_PROJECT_FUNCTIONS = 5000;

export function demoAnalysis(): GameAnalysis {
  return {
    source: "demo",
    game: { title: DEMO_GAME.title, sha256: createHash("sha256").update(DEMO_GAME.descriptor).digest("hex"), sizeBytes: DEMO_GAME.sizeBytes },
    functions: DEMO_FUNCTIONS,
  };
}

const TYPE_MAP: Record<string, Tunable["type"]> = { float: "f32", int: "i32", uint: "i32", dword: "i32" };

/** Keeps the globals that can be tuning values: a 4-byte float/int with a known value and a plain lowercase name. */
function tunablesFrom(globals: AnalysisReport["functions"][number]["globals"]): Tunable[] {
  const out: Tunable[] = [];
  for (const g of globals) {
    const type = g.type ? TYPE_MAP[g.type] : undefined;
    if (!type || g.value === null || g.name === null) continue;
    const t = TunableSchema.safeParse({ name: g.name, address: g.address, type, value: g.value });
    if (t.success && !out.some((x) => x.name === t.data.name)) out.push(t.data);
  }
  return out;
}

/**
 * Turns a schema-checked analyzer report into the project's function list.
 * `title` is chosen by the caller (e.g. the user's name for the game); the
 * file's own name is never used, since it is attacker-controlled.
 */
export function analysisFromReport(report: AnalysisReport, file: { title: string; sha256: string; sizeBytes: number }): GameAnalysis {
  const seen = new Set<string>();
  const functions: AnalyzedFunction[] = [];
  for (const f of report.functions) {
    const id = `fn_${f.entry.slice(2)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    functions.push({ id, address: f.entry, size: f.size, name: f.name, strings: [...f.strings], globals: tunablesFrom(f.globals) });
    if (functions.length === MAX_PROJECT_FUNCTIONS) break;
  }
  return { source: "ghidra", game: { title: file.title.slice(0, 80), sha256: file.sha256, sizeBytes: file.sizeBytes }, functions };
}
