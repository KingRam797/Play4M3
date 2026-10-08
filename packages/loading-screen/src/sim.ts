// Ship, bullets, particles, popups: the simulation, kept free of DOM so the
// behavior is testable. Units are canvas pixels and seconds.
import type { Intent } from "./input.js";

export interface Vec {
  x: number;
  y: number;
}

export interface Ship {
  pos: Vec;
  vel: Vec;
  /** Facing angle in radians (0 = right). */
  angle: number;
  cooldown: number;
}

export interface Bullet {
  pos: Vec;
  vel: Vec;
  life: number;
}

export interface Particle {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  gravity: number;
}

export interface Popup {
  pos: Vec;
  text: string;
  life: number;
}

export const SHIP = {
  accel: 2600,
  maxSpeed: 520,
  drag: 7,
  fireInterval: 0.085,
  bulletSpeed: 1100,
  bulletLife: 1.1,
  margin: 16,
} as const;

export function makeShip(x: number, y: number): Ship {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, angle: -Math.PI / 2, cooldown: 0 };
}

/** Advances the ship; returns the bullets fired this step. */
export function stepShip(ship: Ship, intent: Intent, dt: number, bounds: { w: number; h: number }): Bullet[] {
  let ax = intent.moveX;
  let ay = intent.moveY;
  if (intent.touchTarget && !ax && !ay) {
    const dx = intent.touchTarget.x - ship.pos.x;
    const dy = intent.touchTarget.y - ship.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 24) {
      ax = dx / d;
      ay = dy / d;
    }
  }
  ship.vel.x += ax * SHIP.accel * dt;
  ship.vel.y += ay * SHIP.accel * dt;
  const damp = Math.exp(-SHIP.drag * dt);
  ship.vel.x *= damp;
  ship.vel.y *= damp;
  const speed = Math.hypot(ship.vel.x, ship.vel.y);
  if (speed > SHIP.maxSpeed) {
    ship.vel.x *= SHIP.maxSpeed / speed;
    ship.vel.y *= SHIP.maxSpeed / speed;
  }
  ship.pos.x = clamp(ship.pos.x + ship.vel.x * dt, SHIP.margin, bounds.w - SHIP.margin);
  ship.pos.y = clamp(ship.pos.y + ship.vel.y * dt, SHIP.margin, bounds.h - SHIP.margin);

  if (intent.aim) ship.angle = Math.atan2(intent.aim.y, intent.aim.x);
  else if (ax || ay) ship.angle = Math.atan2(ay, ax);

  ship.cooldown = Math.max(0, ship.cooldown - dt);
  const fired: Bullet[] = [];
  if (intent.fire && ship.cooldown === 0) {
    ship.cooldown = SHIP.fireInterval;
    const dir = { x: Math.cos(ship.angle), y: Math.sin(ship.angle) };
    // Twin cannons, slightly offset left and right of the nose.
    for (const side of [-1, 1]) {
      fired.push({
        pos: { x: ship.pos.x + dir.x * 14 - dir.y * 6 * side, y: ship.pos.y + dir.y * 14 + dir.x * 6 * side },
        vel: { x: dir.x * SHIP.bulletSpeed, y: dir.y * SHIP.bulletSpeed },
        life: SHIP.bulletLife,
      });
    }
  }
  return fired;
}

export function stepBullets(bullets: Bullet[], dt: number, bounds: { w: number; h: number }): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i] as Bullet;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.life -= dt;
    if (b.life <= 0 || b.pos.x < -20 || b.pos.y < -20 || b.pos.x > bounds.w + 20 || b.pos.y > bounds.h + 20) bullets.splice(i, 1);
  }
}

export const MAX_PARTICLES = 2500;

export function stepParticles(ps: Particle[], dt: number, floorY: number): void {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i] as Particle;
    p.vel.y += p.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    if (p.gravity > 0 && p.pos.y > floorY) {
      // Debris bounces once on the floor, then settles and fades.
      p.pos.y = floorY;
      p.vel.y *= -0.35;
      p.vel.x *= 0.6;
    }
    p.life -= dt;
    if (p.life <= 0) ps.splice(i, 1);
  }
}

/** Adds particles without exceeding the cap, dropping the oldest first. */
export function pushParticles(ps: Particle[], add: Particle[]): void {
  ps.push(...add);
  if (ps.length > MAX_PARTICLES) ps.splice(0, ps.length - MAX_PARTICLES);
}

export function stepPopups(pops: Popup[], dt: number): void {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i] as Popup;
    p.pos.y -= 46 * dt;
    p.life -= dt;
    if (p.life <= 0) pops.splice(i, 1);
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Small deterministic PRNG so tests and replays are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
