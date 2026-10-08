// Strict schema for what an analysis worker returns ("p4m3-analysis/0").
// The worker reads attacker-controlled files, so its output is untrusted:
// every field is bounded, unknown keys are rejected, and names/strings stay
// labeled untrusted after parsing (they go behind handles, never to the planner).
import { z } from "zod";

export const ANALYSIS_FORMAT = "p4m3-analysis/0";
export const MAX_FUNCTIONS = 5000;

const Hex = z.string().regex(/^0x[0-9a-f]{1,16}$/);

export const GlobalRefSchema = z
  .object({
    address: Hex,
    /** Symbol name from the file. Untrusted. */
    name: z.string().max(256).nullable(),
    /** Data type name chosen by the analyzer (e.g. "float", "int"). */
    type: z.string().max(64).nullable(),
    value: z.number().finite().nullable(),
  })
  .strict();
export type GlobalRef = z.infer<typeof GlobalRefSchema>;

export const ReportedFunctionSchema = z
  .object({
    entry: Hex,
    size: z.number().int().min(0).max(2 ** 31),
    /** Symbol name from the file. Untrusted. */
    name: z.string().min(1).max(256),
    /** Strings the function references. Untrusted. */
    strings: z.array(z.string().max(512)).max(32),
    globals: z.array(GlobalRefSchema).max(32),
  })
  .strict();
export type ReportedFunction = z.infer<typeof ReportedFunctionSchema>;

export const AnalysisReportSchema = z
  .object({
    format: z.literal(ANALYSIS_FORMAT),
    program: z
      .object({
        name: z.string().max(256),
        language: z.string().regex(/^[A-Za-z0-9_:.-]{1,64}$/),
        imageBase: Hex,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    functions: z.array(ReportedFunctionSchema).max(MAX_FUNCTIONS),
    truncated: z.boolean(),
  })
  .strict();
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

export type ParseResult = { ok: true; report: AnalysisReport } | { ok: false; problem: string };

/** Parses raw worker output. Never throws; problems are reported in fixed wording, never echoing the input. */
export function parseAnalysisReport(raw: Buffer): ParseResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return { ok: false, problem: "output is not valid UTF-8" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: "output is not valid JSON" };
  }
  const parsed = AnalysisReportSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.slice(0, 4).map((p) => (typeof p === "number" ? `[${p}]` : String(p).slice(0, 32))).join(".") : "";
    return { ok: false, problem: `output does not match the schema${where ? ` at ${where}` : ""}` };
  }
  return { ok: true, report: parsed.data };
}
