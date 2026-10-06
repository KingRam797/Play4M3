// Opaque handles for untrusted values (brief §4.2). The planner only ever
// receives the handle id and a fixed-vocabulary description; the value stays here.
import type { HandleId, Labeled } from "@play4m3/core";

/**
 * Fixed vocabulary for where an untrusted value came from. The raw `source`
 * string can contain attacker-chosen text (a filename, a mod name), so the
 * planner only ever sees one of these words.
 */
export const SOURCE_KINDS = ["decompiler", "file", "audio", "mod", "asset", "reader", "unknown"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function sourceKind(source: string): SourceKind {
  const prefix = source.split(":", 1)[0] ?? "";
  return (SOURCE_KINDS as readonly string[]).includes(prefix) ? (prefix as SourceKind) : "unknown";
}

/** Fixed vocabulary for the shape of a handle's value, from the reader schema that produced it. */
export const VALUE_KINDS = ["raw_text", "function_summary", "string_list", "number", "enum", "patch_proposal"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

export interface HandleEntry {
  id: HandleId;
  labeled: Labeled<unknown>;
  valueKind: ValueKind;
}

/** What the planner may know about a handle. Every field is from a fixed vocabulary. */
export interface HandleDescriptor {
  id: HandleId;
  sourceKind: SourceKind;
  valueKind: ValueKind;
}

export class HandleStore {
  private next = 1;
  private readonly entries = new Map<HandleId, HandleEntry>();

  put(labeled: Labeled<unknown>, valueKind: ValueKind): HandleId {
    if (labeled.trust !== "untrusted") throw new Error("only untrusted values go behind handles");
    const id = `$v${this.next++}` as HandleId;
    this.entries.set(id, { id, labeled: Object.freeze({ ...labeled }), valueKind });
    return id;
  }

  get(id: HandleId): HandleEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): id is HandleId {
    return this.entries.has(id as HandleId);
  }

  describe(id: HandleId): HandleDescriptor {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown handle ${id}`);
    return { id, sourceKind: sourceKind(e.labeled.source), valueKind: e.valueKind };
  }

  ids(): HandleId[] {
    return [...this.entries.keys()];
  }
}
