// Decides when the loading screen may close. Rules:
//  - Nothing closes it while loading. A press during loading is reported as
//    "not-ready" so the UI can say so, and is otherwise ignored.
//  - After loading finishes, only a fresh press of the continue control closes it.
//    If the button is already held when loading finishes (e.g. the player was
//    mashing A), it must be released and pressed again. A held button never
//    skips the screen by accident.

export type GatePhase = "loading" | "ready" | "done";
export type PressResult = "not-ready" | "needs-release" | "continued" | "ignored";

export class ContinueGate {
  private phase: GatePhase = "loading";
  private held = false;
  private armed = true;
  private resolveDone: (() => void) | null = null;
  readonly done: Promise<void>;

  constructor() {
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get state(): GatePhase {
    return this.phase;
  }

  /** Loading finished. A button held right now must be released before it counts. */
  markReady(): void {
    if (this.phase !== "loading") return;
    this.phase = "ready";
    this.armed = !this.held;
  }

  /**
   * Feed the continue control's level (true while held) once per frame or per
   * event. Returns what a rising edge meant, or "ignored" for no edge.
   */
  update(isDown: boolean): PressResult {
    const rising = isDown && !this.held;
    const falling = !isDown && this.held;
    this.held = isDown;
    if (falling && this.phase === "ready") this.armed = true;
    if (!rising) return "ignored";
    if (this.phase === "loading") return "not-ready";
    if (this.phase === "done") return "ignored";
    if (!this.armed) return "needs-release";
    this.phase = "done";
    this.resolveDone?.();
    return "continued";
  }
}
