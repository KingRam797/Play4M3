import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, PAD, applyDeadzone, readIntent, validateBindings } from "../src/input.js";
import type { PadSnapshot, RawInput } from "../src/input.js";

function pad(over: Partial<PadSnapshot> = {}): PadSnapshot {
  return { connected: true, buttons: Array<boolean>(17).fill(false), axes: [0, 0, 0, 0], ...over };
}
function press(...idx: number[]): boolean[] {
  const b = Array<boolean>(17).fill(false);
  for (const i of idx) b[i] = true;
  return b;
}
function raw(over: Partial<RawInput> = {}): RawInput {
  return { keys: new Set(), pads: [], touch: { target: null, continueHeld: false }, ...over };
}

describe("input mapping", () => {
  it("A on a standard gamepad is the continue control and does not fire", () => {
    const i = readIntent(raw({ pads: [pad({ buttons: press(PAD.A) })] }));
    expect(i.continueDown).toBe(true);
    expect(i.fire).toBe(false);
    expect(i.device).toBe("gamepad");
  });

  it.each([PAD.X, PAD.RT, PAD.RB])("gamepad button %i fires but does not continue", (b) => {
    const i = readIntent(raw({ pads: [pad({ buttons: press(b) })] }));
    expect(i.fire).toBe(true);
    expect(i.continueDown).toBe(false);
  });

  it("analog trigger past the threshold fires", () => {
    const values = Array<number>(17).fill(0);
    values[PAD.RT] = 0.6;
    expect(readIntent(raw({ pads: [pad({ values })] })).fire).toBe(true);
    values[PAD.RT] = 0.2;
    expect(readIntent(raw({ pads: [pad({ values })] })).fire).toBe(false);
  });

  it("B, Y, Start and the d-pad never continue", () => {
    for (const b of [PAD.B, PAD.Y, PAD.START, PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT]) {
      expect(readIntent(raw({ pads: [pad({ buttons: press(b) })] })).continueDown, String(b)).toBe(false);
    }
  });

  it("Enter continues; Space fires; the A key moves left and does not continue", () => {
    expect(readIntent(raw({ keys: new Set(["Enter"]) })).continueDown).toBe(true);
    expect(readIntent(raw({ keys: new Set(["Space"]) })).fire).toBe(true);
    const a = readIntent(raw({ keys: new Set(["KeyA"]) }));
    expect(a.continueDown).toBe(false);
    expect(a.moveX).toBe(-1);
  });

  it("disconnected pads are ignored", () => {
    expect(readIntent(raw({ pads: [pad({ connected: false, buttons: press(PAD.A) })] })).continueDown).toBe(false);
  });

  it("right stick aims and auto-fires (twin-stick)", () => {
    const i = readIntent(raw({ pads: [pad({ axes: [0, 0, 0.9, 0] })] }));
    expect(i.fire).toBe(true);
    expect(i.aim?.x).toBeGreaterThan(0.8);
  });

  it("stick drift inside the deadzone does nothing", () => {
    const i = readIntent(raw({ pads: [pad({ axes: [0.1, -0.12, 0.15, 0.05] })] }));
    expect(i.moveX).toBe(0);
    expect(i.moveY).toBe(0);
    expect(i.fire).toBe(false);
  });

  it("deadzone rescales smoothly and handles NaN", () => {
    expect(applyDeadzone(0.2, 0)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0).x).toBeCloseTo(1);
    expect(applyDeadzone(Number.NaN, 0)).toEqual({ x: 0, y: 0 });
  });

  it("diagonal keyboard movement is normalized", () => {
    const i = readIntent(raw({ keys: new Set(["KeyW", "KeyD"]) }));
    expect(Math.hypot(i.moveX, i.moveY)).toBeCloseTo(1);
  });

  it("touch: dragging fires, the on-screen A continues", () => {
    expect(readIntent(raw({ touch: { target: { x: 1, y: 2 }, continueHeld: false } })).fire).toBe(true);
    const c = readIntent(raw({ touch: { target: null, continueHeld: true } }));
    expect(c.continueDown).toBe(true);
    expect(c.fire).toBe(false);
  });

  it("bindings where fire and continue overlap are rejected", () => {
    expect(() => validateBindings({ ...DEFAULT_BINDINGS, fireButtons: [PAD.A] })).toThrow();
    expect(() => validateBindings({ ...DEFAULT_BINDINGS, fireKeys: ["Enter"] })).toThrow();
    expect(() => validateBindings({ ...DEFAULT_BINDINGS, continueKeys: [] })).toThrow();
    expect(validateBindings({ ...DEFAULT_BINDINGS, continueButton: PAD.START, continueLabel: "Start" }).continueButton).toBe(PAD.START);
  });

  it("a custom continue button works and A then does nothing", () => {
    const b = { ...DEFAULT_BINDINGS, continueButton: PAD.Y, continueLabel: "Y" };
    expect(readIntent(raw({ pads: [pad({ buttons: press(PAD.Y) })] }), b).continueDown).toBe(true);
    expect(readIntent(raw({ pads: [pad({ buttons: press(PAD.A) })] }), b).continueDown).toBe(false);
  });
});
