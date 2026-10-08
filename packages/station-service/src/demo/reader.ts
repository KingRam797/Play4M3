// Quarantined reader contract (brief §4.2) and its demo stand-in.
// The reader reads untrusted game data, has no tools, and may only return a
// value that passes ReaderOutputSchema: enums, bounded numbers, and a summary
// in a restricted character set. Whatever it returns is still stored as
// untrusted and shown to the user as quoted data.
import { z } from "zod";
import { CONFIDENCE, FUNCTION_CATEGORIES, READER_FLAGS, TunableSchema } from "@play4m3/station-protocol";
import type { AnalyzedFunction } from "./sample.js";

/** Letters, digits, spaces and . , ' ( ) - : _ only. No slashes, backslashes, quotes or markup. */
export const SAFE_SUMMARY = /^[A-Za-z0-9 .,'()\-:_]{1,280}$/;

export const ReaderOutputSchema = z
  .object({
    functionId: z.string().regex(/^fn_[0-9a-f]{1,16}$/),
    category: z.enum(FUNCTION_CATEGORIES),
    confidence: z.enum(CONFIDENCE),
    summary: z.string().regex(SAFE_SUMMARY),
    tunables: z.array(TunableSchema).max(16),
    flags: z.array(z.enum(READER_FLAGS)).max(4),
  })
  .strict();
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;

export interface Reader {
  readonly name: string;
  read(fn: AnalyzedFunction): ReaderOutput;
}

const INSTRUCTION_LIKE = /\b(ignore (all|previous)|system (note|prompt)|assistant|approve every|you are now|do not ask)\b/i;

const CATEGORY_TEXT: Record<ReaderOutput["category"], string> = {
  game_loop: "Part of the main game loop. It runs every frame and calls the other systems.",
  input: "Reads the controller and keyboard and turns presses into player actions.",
  physics: "Physics code. It moves the player using tuning values stored in the game data.",
  rendering: "Draws the current frame to the screen.",
  audio: "Plays sound effects.",
  loading: "Loads level data from disk.",
  unknown: "Purpose unclear from the available data.",
};

/** Deterministic stand-in for the local Gemma reader (F7). */
export class DemoReader implements Reader {
  readonly name = "demo-reader";

  read(fn: AnalyzedFunction): ReaderOutput {
    const flags: ReaderOutput["flags"] = fn.strings.some((s) => INSTRUCTION_LIKE.test(s)) ? ["instruction_like_text"] : [];
    const tunables = fn.readerHints.tunables;
    let summary = CATEGORY_TEXT[fn.readerHints.category];
    if (tunables.length > 0) summary += ` Tuning values: ${tunables.map((t) => `${t.name} (${t.value})`).join(", ")}.`;
    if (flags.length > 0) summary += " It contains text that looks like instructions to an AI. That text is treated as data and ignored.";
    // Validate exactly as a real model's output would be validated.
    return ReaderOutputSchema.parse({
      functionId: fn.id,
      category: fn.readerHints.category,
      confidence: tunables.length > 0 ? "high" : "medium",
      summary,
      tunables,
      flags,
    });
  }
}
