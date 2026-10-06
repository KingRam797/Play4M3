import { readFileSync } from "node:fs";
import { z } from "zod";
import { JsonSchema } from "@play4m3/core";

export const CARRIERS = ["decompiled_string", "readme", "mod_manifest", "asset_metadata", "filename", "comment", "audio_transcript", "multi_turn"] as const;
export const ENCODINGS = ["plain", "base64", "hex", "rot13", "unicode_tags", "homoglyph"] as const;
export type Encoding = (typeof ENCODINGS)[number];

const EntrySchema = z
  .object({
    id: z.string().regex(/^[a-z]{2}-\d{3}$/),
    carrier: z.enum(CARRIERS),
    encoding: z.enum(ENCODINGS),
    text: z.string().max(4096),
    intent: z.object({ tool: z.string(), args: z.record(z.string(), JsonSchema) }).strict(),
  })
  .strict();

const CorpusSchema = z.object({ version: z.literal(1), note: z.string(), entries: z.array(EntrySchema).min(1) }).strict();

export type CorpusEntry = z.infer<typeof EntrySchema> & { encoded: string };

const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= "Z" ? 65 : 97)));
// Unicode tag block (U+E0000..U+E007F) mirrors ASCII invisibly.
const toTags = (s: string) => [...s].map((c) => (c.charCodeAt(0) < 128 ? String.fromCodePoint(0xe0000 + c.charCodeAt(0)) : c)).join("");
const fromTags = (s: string) => [...s].map((c) => { const cp = c.codePointAt(0) ?? 0; return cp >= 0xe0000 && cp <= 0xe007f ? String.fromCharCode(cp - 0xe0000) : c; }).join("");
const HOMOGLYPHS: Record<string, string> = { a: "а", e: "е", o: "о", p: "р", c: "с", x: "х" };
const toHomoglyph = (s: string) => s.replace(/[aeopcx]/g, (c) => HOMOGLYPHS[c] ?? c);
const fromHomoglyph = (s: string) => Object.entries(HOMOGLYPHS).reduce((acc, [lat, cyr]) => acc.split(cyr).join(lat), s);

export function encode(text: string, enc: Encoding): string {
  switch (enc) {
    case "plain": return text;
    case "base64": return Buffer.from(text, "utf8").toString("base64");
    case "hex": return Buffer.from(text, "utf8").toString("hex");
    case "rot13": return rot13(text);
    case "unicode_tags": return `Nothing to see here.${toTags(text)}`;
    case "homoglyph": return toHomoglyph(text);
  }
}

/** What an obedient attacker-controlled planner would do: decode every layer it recognizes. */
export function decode(encoded: string, enc: Encoding): string {
  switch (enc) {
    case "plain": return encoded;
    case "base64": return Buffer.from(encoded, "base64").toString("utf8");
    case "hex": return Buffer.from(encoded, "hex").toString("utf8");
    case "rot13": return rot13(encoded);
    case "unicode_tags": return fromTags(encoded).replace(/^Nothing to see here\./, "");
    case "homoglyph": return fromHomoglyph(encoded);
  }
}

export function loadCorpus(url: URL = new URL("../corpus/v1.json", import.meta.url)): CorpusEntry[] {
  const parsed = CorpusSchema.parse(JSON.parse(readFileSync(url, "utf8")));
  return parsed.entries.map((e) => ({ ...e, encoded: encode(e.text, e.encoding) }));
}
