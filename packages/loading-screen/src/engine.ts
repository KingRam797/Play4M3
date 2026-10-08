// Canvas engine for the destructible loading screen. Everything the player can
// shoot (wordmark, tagline, tip card, fake nav bar) is drawn into an offscreen
// "layer" and mirrored by a DestructibleGrid. The HUD (progress, prompt) is drawn
// on top every frame and cannot be destroyed, so the player can always read it.
//
// The screen never ends by itself. It closes only when loading is done AND the
// continue control (A on a gamepad, Enter, or the on-screen A) is freshly pressed.
import { ContinueGate } from "./continueGate.js";
import type { PressResult } from "./continueGate.js";
import { DestructibleGrid } from "./destructible.js";
import { DEFAULT_BINDINGS, readIntent, validateBindings } from "./input.js";
import type { Bindings, Intent, PadSnapshot, RawInput } from "./input.js";
import { makeShip, mulberry32, pushParticles, stepBullets, stepParticles, stepPopups, stepShip } from "./sim.js";
import type { Bullet, Particle, Popup, Ship } from "./sim.js";

export interface LoadingScreenOptions {
  canvas: HTMLCanvasElement;
  title: string;
  subtitle?: string;
  tips?: readonly string[];
  /** Fake nav labels drawn as a shootable "website" bar across the top. */
  navItems?: readonly string[];
  bindings?: Partial<Bindings>;
  reducedMotion?: boolean;
  /** Called with short status sentences for an aria-live region. */
  announce?: (message: string) => void;
}

export interface LoadingScreenHandle {
  /** 0..1, plus an optional label for what is loading. */
  setProgress(fraction: number, label?: string): void;
  /** Loading finished; the continue control now works. */
  markReady(): void;
  /** Resolves when the player continues. */
  readonly continued: Promise<void>;
  dispose(): void;
}

const DEFAULT_TIPS = [
  "Every change you make becomes a patch you review and approve.",
  "Speak your mod idea. You see the transcript before anything runs.",
  "Your game files never leave your machine.",
  "Nothing writes to disk without your click.",
];

const PALETTE = {
  bg0: "#070914",
  bg1: "#10142b",
  text: "#eef1ff",
  dim: "#9aa3c7",
  cyan: "#3ee6ff",
  violet: "#8a5cff",
  magenta: "#ff4fd8",
  green: "#2fd06b",
  hudBg: "rgba(10, 13, 30, 0.72)",
};

const FIRE_COLORS = [0xfff3b0, 0xffd166, 0xffb340, 0xff7a36, 0xff4f36, 0xc2185b];

// 12 x 9 pixel ship, facing right. . = empty
const SHIP_ART = [
  "..oo........",
  "..oho.......",
  ".ohhhcc.....",
  "ohhhhhccmm..",
  "ohhhhhhhhhhw",
  "ohhhhhccmm..",
  ".ohhhcc.....",
  "..oho.......",
  "..oo........",
];
const SHIP_COLORS: Record<string, string> = { o: "#1b1f3b", h: "#e8ecff", c: PALETTE.cyan, m: PALETTE.magenta, w: "#ffffff" };
const SHIP_PX = 3;

type HintDevice = "gamepad" | "keyboard" | "touch";

export function startLoadingScreen(opts: LoadingScreenOptions): LoadingScreenHandle {
  const bindings = validateBindings({ ...DEFAULT_BINDINGS, ...opts.bindings });
  const canvas = opts.canvas;
  const ctxOrNull = canvas.getContext("2d", { alpha: false });
  if (!ctxOrNull) throw new Error("2D canvas not available");
  const ctx: CanvasRenderingContext2D = ctxOrNull;
  const reduced = opts.reducedMotion ?? false;
  const tips = opts.tips && opts.tips.length > 0 ? opts.tips : DEFAULT_TIPS;
  const navItems = opts.navItems ?? ["PROJECTS", "MODS", "PATCHES", "VOICE", "AUDIT LOG"];
  const rand = mulberry32(0x504c4159); // "PLAY"
  const gate = new ContinueGate();

  // ---- state ---------------------------------------------------------------
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d") as CanvasRenderingContext2D;
  const backdrop = document.createElement("canvas");
  const bctx = backdrop.getContext("2d") as CanvasRenderingContext2D;
  let grid = new DestructibleGrid(1, 1, 1);
  let ship: Ship = makeShip(0, 0);
  const bullets: Bullet[] = [];
  const particles: Particle[] = [];
  const popups: Popup[] = [];
  const stars: Array<{ x: number; y: number; z: number }> = [];
  let tipIndex = 0;
  let progress = 0;
  let progressLabel = "Loading";
  let lastAnnouncedQuarter = -1;
  let shake = 0;
  let hits = 0;
  let lastPopupAt = 0;
  let wrecks = 0;
  let rebuildTimer = -1;
  let layerAlpha = 1;
  let toast: { text: string; life: number } | null = null;
  let hintDevice: HintDevice = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
  let controlsHintLife = 9;
  let time = 0;
  let raf = 0;
  let last = performance.now();
  let disposed = false;

  // ---- input sources ----------------------------------------------------------
  const keys = new Set<string>();
  // Keys and taps pressed since the last frame. A tap shorter than one frame
  // (keydown and keyup between two frames) must still count as a press.
  const tappedKeys = new Set<string>();
  let tappedContinue = false;
  const touch: { target: { x: number; y: number } | null; continueHeld: boolean } = { target: null, continueHeld: false };
  let steerPointer: number | null = null;
  let continuePointer: number | null = null;

  const blockKeys = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", ...bindings.fireKeys, ...bindings.continueKeys]);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (blockKeys.has(e.code)) e.preventDefault();
    if (!e.repeat) tappedKeys.add(e.code);
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
    touch.target = null;
    touch.continueHeld = false;
    steerPointer = continuePointer = null;
  };

  /** Loading bar geometry, shared by the HUD and the A button layout. */
  function barBox(): { x: number; y: number; w: number } {
    const w = Math.min(520, cssW - 64);
    return { x: (cssW - w) / 2, y: cssH - 64, w };
  }
  function aButton(): { x: number; y: number; r: number } {
    const r = Math.max(30, Math.min(44, cssW * 0.05));
    const bar = barBox();
    const x = cssW - r - 24;
    // Bottom-right corner, unless that would sit on the loading bar panel (narrow screens): then lift it above.
    const overlaps = x - r < bar.x + bar.w + 14 + 8;
    return { x, y: overlaps ? bar.y - 30 - 16 - r : cssH - r - 24, r };
  }
  function showAButton(): boolean {
    return hintDevice === "touch" || gate.state === "ready";
  }
  function localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const onPointerDown = (e: PointerEvent): void => {
    const p = localPoint(e);
    if (e.pointerType !== "mouse") hintDevice = "touch";
    const a = aButton();
    if (showAButton() && Math.hypot(p.x - a.x, p.y - a.y) <= a.r + 8) {
      continuePointer = e.pointerId;
      touch.continueHeld = true;
      tappedContinue = true;
    } else if (steerPointer === null) {
      steerPointer = e.pointerId;
      touch.target = p;
    }
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === steerPointer) touch.target = localPoint(e);
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === steerPointer) {
      steerPointer = null;
      touch.target = null;
    }
    if (e.pointerId === continuePointer) {
      continuePointer = null;
      touch.continueHeld = false;
    }
  };

  function readPads(): PadSnapshot[] {
    const list = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    const out: PadSnapshot[] = [];
    for (const g of list) {
      if (!g || !g.connected) continue;
      out.push({ connected: true, buttons: g.buttons.map((b) => b.pressed), values: g.buttons.map((b) => b.value), axes: [...g.axes] });
    }
    return out;
  }

  // ---- layout and the destructible layer -----------------------------------------
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const nextW = Math.max(320, Math.round(rect.width));
    const nextH = Math.max(240, Math.round(rect.height));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    // ResizeObserver also fires on attach; only rebuild (and reset the damage) on a real change.
    if (nextW === cssW && nextH === cssH && nextDpr === dpr) return;
    cssW = nextW;
    cssH = nextH;
    dpr = nextDpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    layer.width = backdrop.width = canvas.width;
    layer.height = backdrop.height = canvas.height;
    stars.length = 0;
    const count = Math.round((cssW * cssH) / 9000);
    for (let i = 0; i < count; i++) stars.push({ x: rand() * cssW, y: rand() * cssH, z: 0.2 + rand() * 0.8 });
    drawBackdrop();
    buildLayer();
    ship = makeShip(cssW * 0.5, cssH * 0.78);
  }

  function drawBackdrop(): void {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = bctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, PALETTE.bg0);
    g.addColorStop(1, PALETTE.bg1);
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, cssW, cssH);
    // A planet rim low on the screen, like the view from an orbital window.
    const r = Math.max(cssW, cssH) * 1.1;
    const cx = cssW * 0.62;
    const cy = cssH + r * 0.82;
    const glow = bctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.06);
    glow.addColorStop(0, "rgba(62, 230, 255, 0.35)");
    glow.addColorStop(1, "rgba(62, 230, 255, 0)");
    bctx.fillStyle = glow;
    bctx.beginPath();
    bctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
    bctx.fill();
    const body = bctx.createRadialGradient(cx - r * 0.2, cy - r * 0.9, r * 0.1, cx, cy, r);
    body.addColorStop(0, "#2b6cb0");
    body.addColorStop(0.5, "#123a6b");
    body.addColorStop(1, "#071a33");
    bctx.fillStyle = body;
    bctx.beginPath();
    bctx.arc(cx, cy, r, 0, Math.PI * 2);
    bctx.fill();
  }

  function wrapLines(c: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (c.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function buildLayer(): void {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    // Fake site nav bar across the top.
    const navY = 22;
    lctx.font = `700 ${Math.max(11, Math.min(14, cssW * 0.012))}px ${sans}`;
    lctx.fillStyle = PALETTE.dim;
    lctx.textBaseline = "middle";
    let nx = cssW - 24;
    for (let i = navItems.length - 1; i >= 0; i--) {
      const label = navItems[i] as string;
      const w = lctx.measureText(label).width;
      nx -= w;
      if (nx < Math.max(cssW * 0.42, 220)) break; // keep clear of the "wrecked" meter
      lctx.fillText(label, nx, navY + 12);
      nx -= 26;
    }
    lctx.fillStyle = "rgba(154, 163, 199, 0.35)";
    lctx.fillRect(24, navY + 34, cssW - 48, 2);

    // Wordmark: "Play" in white, "4M3" in the brand gradient.
    const size = Math.min(cssW * 0.17, cssH * 0.24);
    lctx.font = `900 ${size}px ${sans}`;
    lctx.textBaseline = "alphabetic";
    const title = opts.title;
    const split = Math.max(0, title.search(/\d/));
    const head = split > 0 ? title.slice(0, split) : title;
    const tail = split > 0 ? title.slice(split) : "";
    const headW = lctx.measureText(head).width;
    const tailW = lctx.measureText(tail).width;
    const tx = (cssW - headW - tailW) / 2;
    const ty = cssH * 0.42;
    lctx.fillStyle = PALETTE.text;
    lctx.fillText(head, tx, ty);
    if (tail) {
      const g = lctx.createLinearGradient(tx + headW, 0, tx + headW + tailW, 0);
      g.addColorStop(0, PALETTE.cyan);
      g.addColorStop(0.5, PALETTE.violet);
      g.addColorStop(1, PALETTE.magenta);
      lctx.fillStyle = g;
      lctx.fillText(tail, tx + headW, ty);
    }

    // Tagline.
    if (opts.subtitle) {
      lctx.font = `600 ${Math.max(12, size * 0.13)}px ${sans}`;
      lctx.fillStyle = PALETTE.dim;
      lctx.textAlign = "center";
      lctx.fillText(opts.subtitle.toUpperCase().split("").join(" "), cssW / 2, ty + size * 0.32);
      lctx.textAlign = "start";
    }

    // Tip card.
    const cardW = Math.min(560, cssW - 48);
    const cardX = (cssW - cardW) / 2;
    const cardY = ty + size * 0.5;
    lctx.font = `500 ${Math.max(13, Math.min(17, cssW * 0.016))}px ${sans}`;
    const lines = wrapLines(lctx, tips[tipIndex % tips.length] as string, cardW - 40);
    const lineH = Math.max(18, Math.min(24, cssW * 0.022));
    const cardH = 44 + lines.length * lineH;
    if (cardY + cardH < cssH - 110) {
      lctx.strokeStyle = "rgba(154, 163, 199, 0.55)";
      lctx.lineWidth = 2;
      lctx.beginPath();
      lctx.roundRect(cardX, cardY, cardW, cardH, 12);
      lctx.stroke();
      lctx.fillStyle = PALETTE.cyan;
      lctx.font = `800 12px ${sans}`;
      lctx.fillText("TIP", cardX + 20, cardY + 24);
      lctx.fillStyle = PALETTE.text;
      lctx.font = `500 ${Math.max(13, Math.min(17, cssW * 0.016))}px ${sans}`;
      lines.forEach((l, i) => lctx.fillText(l, cardX + 20, cardY + 30 + lineH * (i + 1) - 6));
    }

    const cell = Math.max(2, Math.round(3 * dpr));
    grid = new DestructibleGrid(layer.width, layer.height, cell);
    grid.load(lctx.getImageData(0, 0, layer.width, layer.height).data);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- effects --------------------------------------------------------------
  const colorCache = new Map<number, string>();
  function css(color: number): string {
    let s = colorCache.get(color);
    if (!s) {
      s = `#${color.toString(16).padStart(6, "0")}`;
      colorCache.set(color, s);
    }
    return s;
  }

  function explode(x: number, y: number, power: number): void {
    const n = Math.round((reduced ? 10 : 22) * power);
    const add: Particle[] = [];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const sp = (60 + rand() * 260) * power;
      add.push({
        pos: { x, y },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        life: 0.35 + rand() * 0.5,
        maxLife: 0.85,
        size: 3 + rand() * 5 * power,
        color: FIRE_COLORS[Math.floor(rand() * FIRE_COLORS.length)] as number,
        gravity: -60,
      });
    }
    pushParticles(particles, add);
    if (!reduced) shake = Math.min(14, shake + 5 * power);
  }

  function onHit(x: number, y: number): void {
    const removed = grid.blast(x * dpr, y * dpr, 13 * dpr);
    if (removed.length === 0) return;
    hits++;
    const s = grid.cellSize;
    lctx.globalCompositeOperation = "destination-out";
    for (const c of removed) lctx.fillRect(c.cx * s, c.cy * s, s, s);
    lctx.globalCompositeOperation = "source-over";

    const add: Particle[] = [];
    const take = Math.min(removed.length, reduced ? 6 : 14);
    for (let i = 0; i < take; i++) {
      const c = removed[Math.floor(rand() * removed.length)] as (typeof removed)[number];
      add.push({
        pos: { x: ((c.cx + 0.5) * s) / dpr, y: ((c.cy + 0.5) * s) / dpr },
        vel: { x: (rand() - 0.5) * 260, y: -80 - rand() * 220 },
        life: 1.2 + rand() * 1.2,
        maxLife: 2.4,
        size: 2 + rand() * 2.5,
        color: c.color,
        gravity: 900,
      });
    }
    for (let i = 0; i < (reduced ? 2 : 5); i++) {
      add.push({ pos: { x, y }, vel: { x: (rand() - 0.5) * 420, y: (rand() - 0.5) * 420 }, life: 0.18, maxLife: 0.18, size: 2, color: 0xffffff, gravity: 0 });
    }
    pushParticles(particles, add);
    if (time - lastPopupAt > 0.09) {
      popups.push({ pos: { x: x + (rand() - 0.5) * 20, y: y - 6 }, text: `-${Math.max(1, Math.min(99, removed.length))}`, life: 0.8 });
      lastPopupAt = time;
    }
    if (hits % 7 === 0 || removed.length > 40) explode(x, y, 1);
    if (!reduced) shake = Math.min(14, shake + 1.2);

    if (rebuildTimer < 0 && grid.destroyedRatio() >= 0.85) {
      rebuildTimer = 1.4;
      wrecks++;
      explode(cssW / 2, cssH * 0.4, 2.2);
      opts.announce?.("Screen wrecked. Rebuilding.");
    }
  }

  // ---- update/draw ------------------------------------------------------------
  function handlePress(result: PressResult): void {
    if (result === "not-ready") toast = { text: `Still loading… ${Math.round(progress * 100)}%`, life: 1.4 };
    if (result === "needs-release") toast = { text: "Release and press again", life: 1.4 };
    if (result === "continued") opts.announce?.("Continuing.");
  }

  function update(dt: number): void {
    time += dt;
    const raw: RawInput = {
      keys: tappedKeys.size > 0 ? new Set([...keys, ...tappedKeys]) : keys,
      pads: readPads(),
      touch: { target: touch.target, continueHeld: touch.continueHeld || tappedContinue },
    };
    tappedKeys.clear();
    tappedContinue = false;
    const intent: Intent = readIntent(raw, bindings);
    if (intent.device) hintDevice = intent.device;
    if (intent.moveX || intent.moveY || intent.fire) controlsHintLife = Math.min(controlsHintLife, 3);
    handlePress(gate.update(intent.continueDown));

    const fired = stepShip(ship, intent, dt, { w: cssW, h: cssH });
    bullets.push(...fired);
    // March each bullet through the grid so fast shots cannot skip thin strokes.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i] as Bullet;
      const steps = Math.max(1, Math.ceil((Math.hypot(b.vel.x, b.vel.y) * dt) / 4));
      let hit = false;
      for (let k = 1; k <= steps && !hit; k++) {
        const px = b.pos.x + (b.vel.x * dt * k) / steps;
        const py = b.pos.y + (b.vel.y * dt * k) / steps;
        if (layerAlpha > 0.5 && grid.isSolidAt(px * dpr, py * dpr)) {
          onHit(px, py);
          hit = true;
        }
      }
      if (hit) bullets.splice(i, 1);
    }
    stepBullets(bullets, dt, { w: cssW, h: cssH });
    stepParticles(particles, dt, cssH - 6);
    stepPopups(popups, dt);

    if (rebuildTimer >= 0) {
      rebuildTimer -= dt;
      if (rebuildTimer < 0) {
        tipIndex++;
        buildLayer();
        layerAlpha = 0;
      }
    }
    if (layerAlpha < 1) layerAlpha = Math.min(1, layerAlpha + dt * 1.6);
    shake *= Math.exp(-10 * dt);
    if (toast) {
      toast.life -= dt;
      if (toast.life <= 0) toast = null;
    }
    controlsHintLife -= dt;

    if (!reduced) {
      for (const st of stars) {
        st.y += (8 + 30 * st.z) * dt;
        st.x -= ship.vel.x * 0.02 * st.z * dt;
        if (st.y > cssH) st.y -= cssH;
        if (st.x < 0) st.x += cssW;
        if (st.x > cssW) st.x -= cssW;
      }
    }
  }

  function drawShip(): void {
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    ctx.rotate(ship.angle);
    const w = SHIP_ART[0]?.length ?? 0;
    const h = SHIP_ART.length;
    const ox = -(w * SHIP_PX) / 2;
    const oy = -(h * SHIP_PX) / 2;
    // Engine flame.
    const flick = 0.6 + 0.4 * Math.sin(time * 40);
    ctx.fillStyle = "#ffb340";
    ctx.fillRect(ox - SHIP_PX * (2 + 2 * flick), -SHIP_PX * 1.5, SHIP_PX * (2 + 2 * flick), SHIP_PX * 3);
    ctx.fillStyle = "#fff3b0";
    ctx.fillRect(ox - SHIP_PX * 1.5, -SHIP_PX * 0.5, SHIP_PX * 1.5, SHIP_PX);
    SHIP_ART.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = SHIP_COLORS[row[x] as string];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(ox + x * SHIP_PX, oy + y * SHIP_PX, SHIP_PX, SHIP_PX);
      }
    });
    ctx.restore();
  }

  function glyph(x: number, y: number, device: HintDevice, size: number): number {
    // Returns the width drawn. Gamepad/touch: a green round "A". Keyboard: an "Enter" keycap.
    ctx.save();
    if (device === "keyboard") {
      const label = bindings.continueKeys[0] === "Enter" ? "Enter" : (bindings.continueKeys[0] ?? "Enter");
      ctx.font = `700 ${size * 0.5}px system-ui, sans-serif`;
      const w = ctx.measureText(label).width + size * 0.7;
      ctx.fillStyle = "#e8ecff";
      ctx.beginPath();
      ctx.roundRect(x, y - size / 2, w, size, 6);
      ctx.fill();
      ctx.fillStyle = "#10142b";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + size * 0.35, y + 1);
      ctx.restore();
      return w;
    }
    ctx.fillStyle = PALETTE.green;
    ctx.beginPath();
    ctx.arc(x + size / 2, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#06240f";
    ctx.font = `900 ${size * 0.62}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(bindings.continueLabel, x + size / 2, y + 1);
    ctx.restore();
    return size;
  }

  function drawHud(): void {
    const sans = "system-ui, -apple-system, sans-serif";
    // Destroyed meter, top-left.
    const ratio = grid.destroyedRatio();
    ctx.fillStyle = PALETTE.hudBg;
    ctx.beginPath();
    ctx.roundRect(16, 14, 188, 30, 8);
    ctx.fill();
    ctx.fillStyle = "#2a2f52";
    ctx.fillRect(26, 25, 92, 8);
    ctx.fillStyle = PALETTE.magenta;
    ctx.fillRect(26, 25, 92 * ratio, 8);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 12px ${sans}`;
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(ratio * 100)}% wrecked${wrecks ? ` ×${wrecks}` : ""}`, 126, 30);

    // Loading bar, bottom center.
    const { x: barX, y: barY, w: barW } = barBox();
    ctx.fillStyle = PALETTE.hudBg;
    ctx.beginPath();
    ctx.roundRect(barX - 14, barY - 30, barW + 28, 64, 12);
    ctx.fill();
    ctx.fillStyle = "#2a2f52";
    ctx.beginPath();
    ctx.roundRect(barX, barY + 10, barW, 8, 4);
    ctx.fill();
    const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fill.addColorStop(0, PALETTE.cyan);
    fill.addColorStop(1, PALETTE.magenta);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(barX, barY + 10, Math.max(8, barW * progress), 8, 4);
    ctx.fill();

    ctx.font = `700 14px ${sans}`;
    ctx.fillStyle = PALETTE.text;
    ctx.textBaseline = "middle";
    if (gate.state === "loading") {
      ctx.fillText(`${progressLabel}… ${Math.round(progress * 100)}%`, barX, barY - 8);
    } else {
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(time * 5);
      ctx.globalAlpha = pulse;
      ctx.fillText("Ready. Press", barX, barY - 8);
      const w0 = ctx.measureText("Ready. Press ").width;
      const gw = glyph(barX + w0, barY - 8, hintDevice, 22);
      ctx.font = `700 14px ${sans}`;
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(" to continue", barX + w0 + gw, barY - 8);
      ctx.globalAlpha = 1;
    }

    // Controls hint, bottom-left, fades out once the player gets going.
    if (controlsHintLife > 0 && cssW > 640) {
      ctx.globalAlpha = Math.min(1, controlsHintLife);
      ctx.font = `500 12px ${sans}`;
      ctx.fillStyle = PALETTE.dim;
      const hint =
        hintDevice === "gamepad"
          ? "Left stick: fly · Right stick or X / RT: shoot"
          : hintDevice === "touch"
            ? "Touch and drag: fly and shoot"
            : "WASD / arrows: fly · Space: shoot";
      ctx.fillText(hint, 20, cssH - 22);
      ctx.globalAlpha = 1;
    }

    // On-screen A button.
    if (showAButton()) {
      const a = aButton();
      // Exposed for assistive tooling and end-to-end tests: where the on-screen continue button is.
      const where = `${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.r)}`;
      if (canvas.dataset["continueButton"] !== where) canvas.dataset["continueButton"] = where;
      ctx.globalAlpha = gate.state === "ready" ? 1 : 0.35;
      ctx.fillStyle = touch.continueHeld ? "#22a456" : PALETTE.green;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#06240f";
      ctx.font = `900 ${a.r}px ${sans}`;
      ctx.textAlign = "center";
      ctx.fillText(bindings.continueLabel, a.x, a.y + 2);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }

    if (toast) {
      ctx.globalAlpha = Math.min(1, toast.life * 3);
      ctx.font = `700 14px ${sans}`;
      const w = ctx.measureText(toast.text).width + 28;
      ctx.fillStyle = PALETTE.hudBg;
      ctx.beginPath();
      ctx.roundRect((cssW - w) / 2, barY - 78, w, 32, 8);
      ctx.fill();
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = "center";
      ctx.fillText(toast.text, cssW / 2, barY - 62);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }
  }

  function draw(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    const sx = shake ? (rand() - 0.5) * shake : 0;
    const sy = shake ? (rand() - 0.5) * shake : 0;
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);

    for (const st of stars) {
      ctx.globalAlpha = 0.3 + st.z * 0.7;
      ctx.fillStyle = "#cfd8ff";
      const sz = st.z > 0.75 ? 2 : 1;
      ctx.fillRect(st.x, st.y, sz, sz);
    }
    ctx.globalAlpha = layerAlpha;
    ctx.drawImage(layer, 0, 0, cssW, cssH);
    ctx.globalAlpha = 1;

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
      ctx.fillStyle = css(p.color);
      ctx.fillRect(p.pos.x - p.size / 2, p.pos.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff3b0";
    for (const b of bullets) ctx.fillRect(b.pos.x - 2, b.pos.y - 2, 4, 4);
    drawShip();

    ctx.font = "900 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#10142b";
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.pos.x, p.pos.y);
      ctx.fillText(p.text, p.pos.x, p.pos.y);
    }
    ctx.textAlign = "start";
    ctx.globalAlpha = 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // HUD does not shake
    drawHud();
  }

  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---- wire up ----------------------------------------------------------------
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  resize();
  raf = requestAnimationFrame(frame);
  opts.announce?.("Loading. Fly and shoot while you wait.");

  return {
    setProgress(fraction: number, label?: string): void {
      progress = Math.max(progress, Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)));
      if (label) progressLabel = label;
      const quarter = Math.floor(progress * 4);
      if (quarter !== lastAnnouncedQuarter && quarter < 4) {
        lastAnnouncedQuarter = quarter;
        opts.announce?.(`Loading ${Math.round(progress * 100)} percent.`);
      }
    },
    markReady(): void {
      progress = 1;
      gate.markReady();
      opts.announce?.(`Loading complete. Press ${bindings.continueLabel} on a controller, or Enter, to continue.`);
    },
    continued: gate.done,
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
