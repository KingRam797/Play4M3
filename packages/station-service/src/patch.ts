// Patch building (pure). A patch records which tuning value changes, from what
// to what, and which original game it applies to (by sha256). It never
// contains game code or assets (brief §2.1).
import { z } from "zod";
import type { PatchChange } from "@play4m3/station-protocol";
import { ReaderOutputSchema } from "./demo/reader.js";
import type { ReaderOutput } from "./demo/reader.js";

export const ChangeRequestSchema = z
  .object({
    tunable: z.enum(["jump_velocity", "gravity", "run_speed"]),
    factor: z.number().finite().min(0.1).max(10),
  })
  .strict();
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/** Arguments of the patch.write tool after the guard resolves handles. */
export const PatchWriteArgsSchema = z
  .object({
    summary: ReaderOutputSchema,
    change: ChangeRequestSchema,
    path: z.string().regex(/^mods\/[a-z0-9.-]{1,80}\.p4m3patch\.json$/),
  })
  .strict();
export type PatchWriteArgs = z.infer<typeof PatchWriteArgsSchema>;

export class PatchError extends Error {
  override name = "PatchError";
}

export interface PatchFile {
  format: "play4m3-patch/0";
  game: { title: string; sha256: string };
  changes: PatchChange[];
  note: string;
}

export function computeChanges(summary: ReaderOutput, change: ChangeRequest): PatchChange[] {
  const t = summary.tunables.find((x) => x.name === change.tunable);
  if (!t) throw new PatchError(`The selected function has no tuning value named ${change.tunable}.`);
  const raw = t.value * change.factor;
  const after = t.type === "i32" ? Math.round(raw) : Math.round(raw * 10000) / 10000;
  return [{ tunable: t.name, address: t.address, type: t.type, before: t.value, after }];
}

export function buildPatchFile(args: PatchWriteArgs, game: { title: string; sha256: string }): PatchFile {
  return {
    format: "play4m3-patch/0",
    game,
    changes: computeChanges(args.summary, args.change),
    note: "Applies only to the original game file with this sha256. Contains no game code or assets.",
  };
}
