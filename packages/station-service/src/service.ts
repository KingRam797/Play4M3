// Station service: runs in the main process, owns all state and every side
// effect. The renderer only sees ViewState snapshots and can only send the
// requests in STATION_REQUESTS. Model output never acts directly:
//   user text -> planner (handles only, S1) -> guard (policy, taint) ->
//   approval card -> native confirm dialog (outside the renderer) -> tool.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CapabilityManifest, HandleId, Json, ToolRequest } from "@play4m3/core";
import { checkWorkspacePath } from "@play4m3/core/node";
import { AuditLog, Guard, HandleStore, HmacApprovalAuthority, buildPlannerInput, verifyChain } from "@play4m3/guard";
import type { AuditEntry, GuardResult, PlannerInput, ToolSpec } from "@play4m3/guard";
import { CommandTextSchema, ProjectNameSchema, ViewStateSchema } from "@play4m3/station-protocol";
import type { ApprovalCard, PatchChange, ViewState } from "@play4m3/station-protocol";
import { DemoPlanner } from "./demo/planner.js";
import type { Planner } from "./demo/planner.js";
import { DemoReader, ReaderOutputSchema } from "./demo/reader.js";
import type { Reader, ReaderOutput } from "./demo/reader.js";
import { DEMO_FUNCTIONS, DEMO_GAME } from "./demo/sample.js";
import type { AnalyzedFunction } from "./demo/sample.js";
import { ChangeRequestSchema, PatchError, PatchWriteArgsSchema, buildPatchFile, computeChanges } from "./patch.js";

/** What the native confirm dialog shows. Built only from trusted or validated values, never raw game text. */
export interface ConfirmPrompt {
  title: string;
  message: string;
  detail: string;
}

export interface StationServiceOptions {
  /** Each project gets its own folder under here. */
  workspaceRoot: string;
  /** Shows a native dialog in the main process. Resolves true only on an explicit "Approve" click. */
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
  /** Where the ownership attestation is stored. */
  attestationFile: string;
  reader?: Reader;
  planner?: Planner;
  now?: () => Date;
}

export const ATTESTATION_TEXT = "I own this game or have the right to analyze it.";

export const STATION_MANIFEST: CapabilityManifest = [{ tool: "patch.write", pathScope: ["mods"], net: "deny", approval: "user" }];

const PLANNER_TOOLS = [{ name: "patch.write", description: "Write a patch file that changes one tuning value of the selected function." }];

interface ProjectState {
  id: string;
  name: string;
  root: string;
  game: { title: string; sha256: string; sizeBytes: number };
  functions: readonly AnalyzedFunction[];
  rawHandles: Map<string, HandleId>;
  explanations: Map<string, { handle: HandleId; output: ReaderOutput }>;
  selectedFunctionId: string | null;
  patches: Array<{ id: string; name: string; path: string; changes: PatchChange[] }>;
  transcript: Array<{ id: string; role: "you" | "station"; text: string; at: string }>;
  handles: HandleStore;
  guard: Guard;
}

export class StationService {
  private attested = false;
  private readonly projects = new Map<string, ProjectState>();
  private activeId: string | null = null;
  private notice: ViewState["notice"] = null;
  private readonly audit = new AuditLog();
  private readonly approvals = new HmacApprovalAuthority();
  private readonly reader: Reader;
  private readonly planner: Planner;
  private readonly now: () => Date;
  private seq = 0;
  /** Every PlannerInput ever built, for the S1 tests. */
  readonly plannerInputs: PlannerInput[] = [];

  constructor(private readonly opts: StationServiceOptions) {
    this.reader = opts.reader ?? new DemoReader();
    this.planner = opts.planner ?? new DemoPlanner();
    this.now = opts.now ?? (() => new Date());
    this.attested = readAttestation(opts.attestationFile);
    this.audit.append("session", { event: "started", attested: this.attested });
  }

  // ---- requests (all return the new view state) --------------------------------------

  state(): ViewState {
    return this.view();
  }

  attest(): ViewState {
    this.notice = null;
    if (!this.attested) {
      mkdirSync(path.dirname(this.opts.attestationFile), { recursive: true });
      writeFileSync(this.opts.attestationFile, JSON.stringify({ accepted: true, text: ATTESTATION_TEXT, at: this.now().toISOString() }, null, 2));
      this.attested = true;
      this.audit.append("session", { event: "attested" });
    }
    return this.view();
  }

  createProject(rawName: string): ViewState {
    this.notice = null;
    if (!this.attested) return this.fail("Confirm that you own the game first.");
    const name = ProjectNameSchema.safeParse(rawName);
    if (!name.success) return this.fail("Project names can use letters, numbers, spaces and . _ ' ( ) -, up to 80 characters.");
    const id = `p_${randomBytes(5).toString("hex")}`;
    const root = path.join(this.opts.workspaceRoot, id);
    mkdirSync(path.join(root, "mods"), { recursive: true });
    const handles = new HandleStore();
    const project: ProjectState = {
      id,
      name: name.data,
      root,
      game: { title: DEMO_GAME.title, sha256: createHash("sha256").update(DEMO_GAME.descriptor).digest("hex"), sizeBytes: DEMO_GAME.sizeBytes },
      functions: DEMO_FUNCTIONS,
      rawHandles: new Map(),
      explanations: new Map(),
      selectedFunctionId: null,
      patches: [],
      transcript: [],
      handles,
      guard: new Guard(STATION_MANIFEST, [this.patchWriteTool(() => project)], handles, this.approvals, this.audit),
    };
    // Raw analysis output is untrusted and goes behind handles straight away.
    for (const fn of project.functions) {
      project.rawHandles.set(fn.id, handles.put({ value: fn as unknown as Json, trust: "untrusted", source: "decompiler:demo" }, "raw_text"));
    }
    this.projects.set(id, project);
    this.activeId = id;
    this.audit.append("session", { event: "project_created", project: id });
    this.say(project, "station", `Project ready. ${project.functions.length} functions found in the sample game. Pick one to see what it does.`);
    return this.view();
  }

  selectProject(id: string): ViewState {
    this.notice = null;
    if (!this.projects.has(id)) return this.fail("That project does not exist.");
    this.activeId = id;
    return this.view();
  }

  /** User clicked a function: the quarantined reader explains it. Not a planner action. */
  selectFunction(id: string): ViewState {
    this.notice = null;
    const p = this.active();
    if (!p) return this.fail("Open a project first.");
    const fn = p.functions.find((f) => f.id === id);
    if (!fn) return this.fail("That function is not in this project.");
    p.selectedFunctionId = fn.id;
    if (!p.explanations.has(fn.id)) {
      const output = ReaderOutputSchema.parse(this.reader.read(fn));
      const handle = p.handles.put({ value: output as unknown as Json, trust: "untrusted", source: `reader:${this.reader.name}` }, "function_summary");
      p.explanations.set(fn.id, { handle, output });
      this.audit.append("model_call", { role: "reader", model: this.reader.name, functionId: fn.id, flags: output.flags });
    }
    return this.view();
  }

  /** Typed command from the user: the planner proposes, the guard decides. */
  async command(rawText: string): Promise<ViewState> {
    this.notice = null;
    const p = this.active();
    if (!p) return this.fail("Open a project first.");
    const text = CommandTextSchema.safeParse(rawText);
    if (!text.success) return this.fail("Type a request of up to 500 characters.");
    this.say(p, "you", text.data);

    const selected = p.selectedFunctionId ? p.explanations.get(p.selectedFunctionId) : undefined;
    const input = buildPlannerInput({
      userTurns: [{ value: text.data, trust: "user_typed", source: "ui:command" }],
      handles: p.handles,
      visibleHandles: selected ? [selected.handle] : [],
      tools: PLANNER_TOOLS,
    });
    this.plannerInputs.push(input);
    this.audit.append("model_call", { role: "planner", model: this.planner.name, turns: input.turns.length, handles: input.handles.length });
    const plan = this.planner.plan(input);
    this.say(p, "station", plan.reply);

    for (const call of plan.calls) {
      const result: GuardResult = await p.guard.propose(call);
      if (result.status === "denied") this.say(p, "station", `Blocked by the safety rules (${result.rule}). Nothing was changed.`);
      if (result.status === "pending_approval") {
        const card = this.card(result.request);
        if (card.problem) {
          p.guard.reject(result.requestId);
          this.say(p, "station", `${card.problem} I cancelled that request.`);
        }
      }
    }
    return this.view();
  }

  async decide(requestId: string, decision: "approve" | "reject"): Promise<ViewState> {
    this.notice = null;
    const p = this.active();
    if (!p) return this.fail("Open a project first.");
    const request = p.guard.pendingRequests().find((r) => r.id === requestId);
    if (!request) return this.fail("That request is no longer waiting for approval.");
    const card = this.card(request);

    if (decision === "reject") {
      p.guard.reject(requestId);
      this.say(p, "station", `You rejected: ${card.title}. Nothing was changed.`);
      return this.view();
    }
    if (card.problem) return this.fail(card.problem);

    const ok = await this.opts.confirm(confirmPrompt(card));
    if (!ok) {
      this.notice = { tone: "info", text: "Not approved. The request is still waiting in the queue." };
      return this.view();
    }
    try {
      const result = await p.guard.approve(requestId);
      if (result.status === "executed") {
        this.notice = { tone: "info", text: `Patch written to ${card.paths[0] ?? "mods/"}.` };
        this.say(p, "station", `Done. ${card.title}. The patch file is in your project's mods folder.`);
      } else if (result.status === "denied") {
        this.fail(`The safety rules blocked it (${result.rule}).`);
      }
    } catch (err) {
      this.audit.append("execution", { requestId, failed: true, error: (err as Error).name });
      this.fail(err instanceof PatchError ? err.message : `The change could not be written: ${(err as Error).message.slice(0, 120)}`);
    }
    return this.view();
  }

  // ---- tools --------------------------------------------------------------------------

  private patchWriteTool(project: () => ProjectState): ToolSpec {
    return {
      name: "patch.write",
      description: PLANNER_TOOLS[0]?.description ?? "",
      args: PatchWriteArgsSchema as unknown as ToolSpec["args"],
      pathArgs: ["path"],
      run: (raw) => {
        const p = project();
        const args = PatchWriteArgsSchema.parse(raw);
        const file = buildPatchFile(args, { title: p.game.title, sha256: p.game.sha256 });
        const target = checkWorkspacePath(p.root, args.path, { forWrite: true });
        if (!target.ok) throw new Error(`refused path (${target.rule})`);
        if (existsSync(target.absolute)) throw new PatchError("A patch file with that name already exists in mods. Delete it first or ask for a different change.");
        mkdirSync(path.dirname(target.absolute), { recursive: true });
        writeFileSync(target.absolute, `${JSON.stringify(file, null, 2)}\n`, { flag: "wx" });
        p.patches.push({ id: `patch_${p.patches.length + 1}`, name: path.basename(args.path), path: args.path, changes: file.changes });
        return { written: args.path };
      },
    };
  }

  // ---- view ---------------------------------------------------------------------------

  private card(request: ToolRequest): ApprovalCard {
    const base = { requestId: request.id, tool: request.tool, paths: request.paths, fromGameData: request.taintedBy.length > 0 };
    if (request.tool !== "patch.write") return { ...base, title: `Run ${request.tool}`, changes: [], problem: null };
    const args = PatchWriteArgsSchema.safeParse(request.args);
    const change = ChangeRequestSchema.safeParse((request.args as Record<string, unknown>)["change"]);
    const title = change.success ? `Change ${change.data.tunable} to ${change.data.factor}x` : "Write a patch";
    if (!args.success) return { ...base, title, changes: [], problem: "The request did not match the patch format." };
    try {
      return { ...base, title, changes: computeChanges(args.data.summary, args.data.change), problem: null };
    } catch (err) {
      return { ...base, title, changes: [], problem: err instanceof PatchError ? err.message : "The patch could not be computed." };
    }
  }

  private view(): ViewState {
    const p = this.active();
    const entries = this.audit.all();
    const chain = verifyChain(entries);
    const state: ViewState = {
      demo: true,
      attested: this.attested,
      projects: [...this.projects.values()].map((x) => ({ id: x.id, name: x.name })),
      project: p
        ? {
            id: p.id,
            name: p.name,
            game: p.game,
            functions: p.functions.map((f) => ({ id: f.id, address: f.address, size: f.size, name: f.name, explained: p.explanations.has(f.id) })),
            selectedFunctionId: p.selectedFunctionId,
            explanation: (() => {
              const e = p.selectedFunctionId ? p.explanations.get(p.selectedFunctionId) : undefined;
              if (!e) return null;
              const { functionId, category, confidence, summary, tunables, flags } = e.output;
              return { functionId, category, confidence, summary, tunables, flags };
            })(),
            patches: p.patches.map((x) => ({ ...x, status: "written" as const })),
            approvals: p.guard.pendingRequests().map((r) => this.card(r)),
            transcript: p.transcript.slice(-200),
          }
        : null,
      audit: {
        rows: entries.slice(-200).map(auditRow),
        total: entries.length,
        chainOk: chain.ok,
        head: this.audit.head(),
      },
      notice: this.notice,
    };
    return ViewStateSchema.parse(state);
  }

  private active(): ProjectState | undefined {
    return this.activeId ? this.projects.get(this.activeId) : undefined;
  }

  private say(p: ProjectState, role: "you" | "station", text: string): void {
    p.transcript.push({ id: `t_${++this.seq}`, role, text: text.slice(0, 2000), at: this.now().toISOString() });
  }

  private fail(text: string): ViewState {
    this.notice = { tone: "error", text };
    return this.view();
  }
}

// ---- helpers -----------------------------------------------------------------------------

function readAttestation(file: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { accepted?: unknown; text?: unknown };
    return parsed.accepted === true && parsed.text === ATTESTATION_TEXT;
  } catch {
    return false;
  }
}

/** Native dialog text. Only trusted or schema-validated values: no function names, no game strings. */
export function confirmPrompt(card: ApprovalCard): ConfirmPrompt {
  const detail = card.changes.map((c) => `${c.tunable} at ${c.address} (${c.type}): ${c.before} -> ${c.after}`);
  detail.push("");
  if (card.fromGameData) detail.push("Part of this request was computed from data read from the game file.");
  detail.push("The patch file contains no game code or assets.");
  return { title: "Approve this change?", message: `${card.title}\nWrite ${card.paths.join(", ")}`, detail: detail.join("\n") };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function auditRow(e: AuditEntry): ViewState["audit"]["rows"][number] {
  const d = (e.data ?? {}) as Record<string, unknown>;
  let summary: string;
  switch (e.kind) {
    case "session":
      summary = `Session: ${str(d["event"]).replace(/_/g, " ")}`;
      break;
    case "model_call":
      summary = d["role"] === "reader" ? "Reader explained a function (game data, quarantined)" : `Planner read your command (${Number(d["handles"] ?? 0)} handle(s), no game text)`;
      break;
    case "tool_call":
      summary = `Proposed ${str(d["tool"])}`;
      break;
    case "decision":
      summary = d["allow"] === true ? `Allowed: ${str(d["reason"])}` : str(d["rule"]) === "approval.missing" ? "Waiting for your approval" : `Denied: ${str(d["rule"])}`;
      break;
    case "approval":
      summary = d["rejected"] === true ? "You rejected a request" : "You approved a request";
      break;
    case "execution":
      summary = d["failed"] === true ? "A tool failed; nothing was written" : `Ran ${str(d["tool"])}`;
      break;
    default:
      summary = e.kind;
  }
  return { seq: e.seq, at: e.ts, kind: e.kind, summary: summary.slice(0, 300), hash: e.hash.slice(0, 12) };
}
