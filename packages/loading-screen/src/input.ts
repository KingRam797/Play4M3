// Maps raw device state (keyboard, standard-mapping gamepads, touch) to the
// three things the loading screen cares about: move, aim/fire, continue.
// Pure: the engine samples devices and passes plain data in.

/** W3C "standard" gamepad mapping indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface Bindings {
  /** Gamepad button that closes the screen once loading is done. */
  continueButton: number;
  continueKeys: readonly string[];
  /** Human label for the continue control, e.g. "A". */
  continueLabel: string;
  fireButtons: readonly number[];
  fireKeys: readonly string[];
}

export const DEFAULT_BINDINGS: Bindings = Object.freeze({
  continueButton: PAD.A,
  continueKeys: Object.freeze(["Enter", "NumpadEnter"]),
  continueLabel: "A",
  fireButtons: Object.freeze([PAD.X, PAD.RT, PAD.RB]),
  fireKeys: Object.freeze(["Space", "KeyJ"]),
});

/** Throws if a binding would let the fire control also close the screen. */
export function validateBindings(b: Bindings): Bindings {
  if (b.fireButtons.includes(b.continueButton)) throw new Error("continue button must not also fire");
  if (b.fireKeys.some((k) => b.continueKeys.includes(k))) throw new Error("continue key must not also fire");
  if (b.continueKeys.length === 0) throw new Error("need at least one continue key");
  return b;
}

export interface PadSnapshot {
  connected: boolean;
  /** pressed flag per button, standard mapping */
  buttons: readonly boolean[];
  /** analog value per button (triggers), 0..1 */
  values?: readonly number[];
  axes: readonly number[];
}

export interface TouchSnapshot {
  /** Finger target in canvas pixels, if a move/fire finger is down. */
  target: { x: number; y: number } | null;
  /** On-screen continue button held. */
  continueHeld: boolean;
}

export interface RawInput {
  keys: ReadonlySet<string>;
  pads: readonly PadSnapshot[];
  touch: TouchSnapshot;
}

export interface Intent {
  moveX: number; // -1..1
  moveY: number; // -1..1
  /** Aim direction if the player is aiming explicitly (right stick), else null. */
  aim: { x: number; y: number } | null;
  fire: boolean;
  /** Level (held) state of the continue control across all devices. */
  continueDown: boolean;
  /** Touch target to steer toward, if any. */
  touchTarget: { x: number; y: number } | null;
  /** Which device produced input most recently: drives the on-screen hint glyphs. */
  device: "keyboard" | "gamepad" | "touch" | null;
}

export const STICK_DEADZONE = 0.22;
const TRIGGER_THRESHOLD = 0.35;

/** Radial deadzone with rescale so motion starts smoothly at the edge of the zone. */
export function applyDeadzone(x: number, y: number, dz = STICK_DEADZONE): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (!Number.isFinite(mag) || mag < dz) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

function padPressed(p: PadSnapshot, i: number): boolean {
  if (p.buttons[i]) return true;
  const v = p.values?.[i];
  return typeof v === "number" && v > TRIGGER_THRESHOLD;
}

export function readIntent(raw: RawInput, b: Bindings = DEFAULT_BINDINGS): Intent {
  let moveX = 0;
  let moveY = 0;
  let fire = false;
  let continueDown = false;
  let aim: Intent["aim"] = null;
  let device: Intent["device"] = null;

  const k = raw.keys;
  const kx = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
  const ky = (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0);
  if (kx || ky) {
    moveX = kx;
    moveY = ky;
  }
  if (b.fireKeys.some((key) => k.has(key))) fire = true;
  if (b.continueKeys.some((key) => k.has(key))) continueDown = true;
  if (k.size > 0) device = "keyboard";

  for (const p of raw.pads) {
    if (!p.connected) continue;
    const left = applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const dx = (padPressed(p, PAD.RIGHT) ? 1 : 0) - (padPressed(p, PAD.LEFT) ? 1 : 0);
    const dy = (padPressed(p, PAD.DOWN) ? 1 : 0) - (padPressed(p, PAD.UP) ? 1 : 0);
    const mx = left.x || dx;
    const my = left.y || dy;
    if (mx || my) {
      moveX = mx;
      moveY = my;
      device = "gamepad";
    }
    const right = applyDeadzone(p.axes[2] ?? 0, p.axes[3] ?? 0);
    if (right.x || right.y) {
      aim = right;
      fire = true; // twin-stick: aiming fires
      device = "gamepad";
    }
    if (b.fireButtons.some((i) => padPressed(p, i))) {
      fire = true;
      device = "gamepad";
    }
    if (padPressed(p, b.continueButton)) {
      continueDown = true;
      device = "gamepad";
    }
  }

  if (raw.touch.target) {
    fire = true; // touching the playfield steers and auto-fires
    device = "touch";
  }
  if (raw.touch.continueHeld) {
    continueDown = true;
    device = "touch";
  }

  // Normalize diagonal keyboard/d-pad movement.
  const mag = Math.hypot(moveX, moveY);
  if (mag > 1) {
    moveX /= mag;
    moveY /= mag;
  }
  return { moveX, moveY, aim, fire, continueDown, touchTarget: raw.touch.target, device };
}
