import { describe, expect, it } from "vitest";
import { DestructibleGrid } from "../src/destructible.js";
import { MAX_PARTICLES, SHIP, makeShip, mulberry32, pushParticles, stepBullets, stepParticles, stepShip } from "../src/sim.js";
import type { Intent } from "../src/input.js";
import type { Particle } from "../src/sim.js";

/** w x h RGBA image with an opaque colored rectangle. */
function image(w: number, h: number, rect: { x: number; y: number; w: number; h: number }, rgb = [255, 79, 216]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * w + x) * 4;
      a[i] = rgb[0] ?? 0;
      a[i + 1] = rgb[1] ?? 0;
      a[i + 2] = rgb[2] ?? 0;
      a[i + 3] = 255;
    }
  return a;
}

describe("DestructibleGrid", () => {
  it("marks cells solid where pixels are opaque, with their color", () => {
    const g = new DestructibleGrid(30, 30, 3);
    g.load(image(30, 30, { x: 9, y: 9, w: 12, h: 12 }));
    expect(g.totalCells).toBe(16);
    expect(g.isSolidAt(10, 10)).toBe(true);
    expect(g.isSolidAt(2, 2)).toBe(false);
    expect(g.destroyedRatio()).toBe(0);
  });

  it("blast removes only solid cells inside the radius and returns them once", () => {
    const g = new DestructibleGrid(30, 30, 3);
    g.load(image(30, 30, { x: 0, y: 0, w: 30, h: 30 }, [62, 230, 255]));
    const first = g.blast(15, 15, 5);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((c) => c.color === 0x3ee6ff)).toBe(true);
    expect(g.isSolidAt(15, 15)).toBe(false);
    expect(g.isSolidAt(1, 1)).toBe(true);
    expect(g.blast(15, 15, 5)).toEqual([]); // already gone
    expect(g.aliveCells).toBe(g.totalCells - first.length);
  });

  it("destroyed ratio reaches 1 when everything is gone", () => {
    const g = new DestructibleGrid(12, 12, 3);
    g.load(image(12, 12, { x: 0, y: 0, w: 12, h: 12 }));
    g.blast(6, 6, 100);
    expect(g.destroyedRatio()).toBe(1);
  });

  it("is safe at the edges and with an empty layer", () => {
    const g = new DestructibleGrid(10, 7, 3); // non-multiple size
    g.load(new Uint8ClampedArray(10 * 7 * 4));
    expect(g.blast(-50, -50, 10)).toEqual([]);
    expect(g.isSolidAt(1e9, 1e9)).toBe(false);
    expect(g.destroyedRatio()).toBe(0);
  });

  it("rejects a mismatched buffer and bad cell size", () => {
    expect(() => new DestructibleGrid(10, 10, 3).load(new Uint8ClampedArray(4))).toThrow();
    expect(() => new DestructibleGrid(10, 10, 0)).toThrow();
    expect(() => new DestructibleGrid(10, 10, 1.5)).toThrow();
  });

  it("reloading restores the layer (the screen rebuilds after being wrecked)", () => {
    const g = new DestructibleGrid(12, 12, 3);
    const img = image(12, 12, { x: 0, y: 0, w: 12, h: 12 });
    g.load(img);
    g.blast(6, 6, 100);
    g.load(img);
    expect(g.destroyedRatio()).toBe(0);
  });
});

const idle: Intent = { moveX: 0, moveY: 0, aim: null, fire: false, continueDown: false, touchTarget: null, device: null };

describe("simulation", () => {
  it("ship stays on screen", () => {
    const s = makeShip(10, 10);
    for (let i = 0; i < 120; i++) stepShip(s, { ...idle, moveX: -1, moveY: -1 }, 1 / 60, { w: 400, h: 300 });
    expect(s.pos.x).toBeGreaterThanOrEqual(SHIP.margin);
    expect(s.pos.y).toBeGreaterThanOrEqual(SHIP.margin);
  });

  it("fires twin shots on a cooldown", () => {
    const s = makeShip(100, 100);
    const first = stepShip(s, { ...idle, fire: true }, 1 / 60, { w: 400, h: 300 });
    expect(first).toHaveLength(2);
    expect(stepShip(s, { ...idle, fire: true }, 1 / 60, { w: 400, h: 300 })).toHaveLength(0);
    let later: unknown[] = [];
    for (let i = 0; i < 10 && later.length === 0; i++) later = stepShip(s, { ...idle, fire: true }, 1 / 60, { w: 400, h: 300 });
    expect(later).toHaveLength(2);
  });

  it("aim overrides facing", () => {
    const s = makeShip(100, 100);
    stepShip(s, { ...idle, aim: { x: 0, y: 1 }, fire: true }, 1 / 60, { w: 400, h: 300 });
    expect(s.angle).toBeCloseTo(Math.PI / 2);
  });

  it("bullets expire and leave the screen", () => {
    const s = makeShip(100, 100);
    const bullets = stepShip(s, { ...idle, fire: true }, 1 / 60, { w: 400, h: 300 });
    for (let i = 0; i < 200; i++) stepBullets(bullets, 1 / 60, { w: 400, h: 300 });
    expect(bullets).toHaveLength(0);
  });

  it("particles fall, die, and never exceed the cap", () => {
    const rnd = mulberry32(1);
    const ps: Particle[] = [];
    const make = (): Particle => ({ pos: { x: rnd() * 100, y: 0 }, vel: { x: 0, y: 0 }, life: 1, maxLife: 1, size: 2, color: 0, gravity: 900 });
    pushParticles(ps, Array.from({ length: MAX_PARTICLES + 500 }, make));
    expect(ps.length).toBe(MAX_PARTICLES);
    for (let i = 0; i < 90; i++) stepParticles(ps, 1 / 60, 50);
    expect(ps.length).toBe(0);
  });

  it("PRNG is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
