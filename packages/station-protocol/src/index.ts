// The contract between the Station UI (renderer, untrusted) and the station
// service (main process). Every request and every view state crosses IPC and
// is validated with these schemas on both sides. Pure: no DOM, no Node.
import { z } from "zod";

// ---- shared bits ----------------------------------------------------------------

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Hex = z.string().regex(/^0x[0-9a-f]{1,16}$/);
/** Text that came from a game file or a model that read one. Display as quoted data only. */
const UntrustedText = z.string().max(2000);

export const FUNCTION_CATEGORIES = ["game_loop", "input", "physics", "rendering", "audio", "loading", "unknown"] as const;
export const CONFIDENCE = ["low", "medium", "high"] as const;
export const READER_FLAGS = ["instruction_like_text"] as const;

export const TunableSchema = z
  .object({
    name: z.string().regex(/^[a-z_][a-z0-9_]{0,31}$/),
    address: Hex,
    type: z.enum(["f32", "i32"]),
    value: z.number().finite(),
  })
  .strict();
export type Tunable = z.infer<typeof TunableSchema>;

export const PatchChangeSchema = z
  .object({
    tunable: TunableSchema.shape.name,
    address: Hex,
    type: z.enum(["f32", "i32"]),
    before: z.number().finite(),
    after: z.number().finite(),
  })
  .strict();
export type PatchChange = z.infer<typeof PatchChangeSchema>;

// ---- view state -------------------------------------------------------------------

export const FunctionRowSchema = z
  .object({
    id: Id,
    address: Hex,
    size: z.number().int().nonnegative(),
    /** From the game file. Untrusted. */
    name: UntrustedText,
    explained: z.boolean(),
  })
  .strict();

export const ExplanationSchema = z
  .object({
    functionId: Id,
    category: z.enum(FUNCTION_CATEGORIES),
    confidence: z.enum(CONFIDENCE),
    /** Written by the quarantined reader from game data. Untrusted, display only. */
    summary: UntrustedText,
    tunables: z.array(TunableSchema).max(16),
    flags: z.array(z.enum(READER_FLAGS)).max(4),
  })
  .strict();

export const PatchRowSchema = z
  .object({
    id: Id,
    name: z.string().max(80),
    path: z.string().max(200),
    status: z.enum(["written"]),
    changes: z.array(PatchChangeSchema).max(16),
  })
  .strict();

export const ApprovalCardSchema = z
  .object({
    requestId: Id,
    tool: z.string().max(64),
    title: z.string().max(200),
    paths: z.array(z.string().max(200)).max(8),
    /** True when any argument came from game data (taint). */
    fromGameData: z.boolean(),
    changes: z.array(PatchChangeSchema).max(16),
    problem: z.string().max(200).nullable(),
  })
  .strict();

export const TranscriptLineSchema = z
  .object({
    id: Id,
    role: z.enum(["you", "station"]),
    text: z.string().max(2000),
    at: z.string().max(40),
  })
  .strict();

export const AuditRowSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    at: z.string().max(40),
    kind: z.string().max(32),
    summary: z.string().max(300),
    hash: z.string().regex(/^[0-9a-f]{12}$/),
  })
  .strict();

export const ViewStateSchema = z
  .object({
    demo: z.literal(true),
    attested: z.boolean(),
    projects: z.array(z.object({ id: Id, name: z.string().max(80) }).strict()).max(64),
    project: z
      .object({
        id: Id,
        name: z.string().max(80),
        game: z.object({ title: z.string().max(80), sha256: z.string().regex(/^[0-9a-f]{64}$/), sizeBytes: z.number().int().nonnegative() }).strict(),
        functions: z.array(FunctionRowSchema).max(5000),
        selectedFunctionId: Id.nullable(),
        explanation: ExplanationSchema.nullable(),
        patches: z.array(PatchRowSchema).max(256),
        approvals: z.array(ApprovalCardSchema).max(64),
        transcript: z.array(TranscriptLineSchema).max(500),
      })
      .strict()
      .nullable(),
    audit: z.object({ rows: z.array(AuditRowSchema).max(200), total: z.number().int().nonnegative(), chainOk: z.boolean(), head: z.string().max(64) }).strict(),
    notice: z.object({ tone: z.enum(["info", "error"]), text: z.string().max(300) }).strict().nullable(),
  })
  .strict();
export type ViewState = z.infer<typeof ViewStateSchema>;
export type ProjectView = NonNullable<ViewState["project"]>;
export type ApprovalCard = z.infer<typeof ApprovalCardSchema>;
export type FunctionRow = z.infer<typeof FunctionRowSchema>;
export type Explanation = z.infer<typeof ExplanationSchema>;

// ---- requests -----------------------------------------------------------------------

export const ProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N} _.'()-]+$/u, "letters, numbers, spaces and . _ ' ( ) - only");

/** Typed command from the user. Becomes a `user_typed` turn in the planner. */
export const CommandTextSchema = z.string().trim().min(1).max(500);

export const STATION_REQUESTS = {
  "station:state": z.object({}).strict(),
  "station:attest": z.object({ accepted: z.literal(true) }).strict(),
  "station:project.create": z.object({ name: ProjectNameSchema }).strict(),
  "station:project.select": z.object({ id: Id }).strict(),
  "station:function.select": z.object({ id: Id }).strict(),
  "station:command": z.object({ text: CommandTextSchema }).strict(),
  "station:approval.decide": z.object({ requestId: Id, decision: z.enum(["approve", "reject"]) }).strict(),
} as const;

export type StationRequestChannel = keyof typeof STATION_REQUESTS;
export type StationRequest<C extends StationRequestChannel> = z.infer<(typeof STATION_REQUESTS)[C]>;

/** What the renderer can call. Every method returns the full new view state. */
export interface StationApi {
  state(): Promise<ViewState>;
  attest(): Promise<ViewState>;
  createProject(name: string): Promise<ViewState>;
  selectProject(id: string): Promise<ViewState>;
  selectFunction(id: string): Promise<ViewState>;
  command(text: string): Promise<ViewState>;
  decide(requestId: string, decision: "approve" | "reject"): Promise<ViewState>;
}
