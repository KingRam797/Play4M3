// S8: every Electron security setting lives here as plain data and pure
// functions, so the config audit test can check them without launching Electron.
// main.ts must use these values; the audit test also scans main.ts for drift.
import type { WebPreferences } from "electron";

/** The only origin the app ever loads. Served from inside the package via a custom protocol. */
export const APP_SCHEME = "app";
export const APP_HOST = "station";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  enableBlinkFeatures: "",
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
  devTools: false,
  safeDialogs: true,
} satisfies WebPreferences);

/**
 * Strict CSP: no inline script or style, no eval, no remote anything.
 * 'wasm-unsafe-eval' is deliberately absent until a bundled WASM STT engine needs it (F6);
 * adding it requires a DECISIONS.md entry.
 */
export const CSP = [
  "default-src 'none'",
  `script-src 'self'`,
  `style-src 'self'`,
  `img-src 'self' data:`,
  `font-src 'self'`,
  `connect-src 'self'`,
  `media-src 'self' blob:`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self'",
  "manifest-src 'none'",
].join("; ");

export const RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), microphone=(self)",
});

/** True only for URLs on our own app origin. Everything else is remote content. */
export function isAppUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST && u.username === "" && u.password === "" && u.port === "";
}

/** will-navigate / will-redirect / will-frame-navigate: allow in-app only. */
export function allowNavigation(url: string): boolean {
  return isAppUrl(url);
}

/** setWindowOpenHandler: never open new windows. External links are a later, approval-gated feature. */
export function windowOpenDecision(): { action: "deny" } {
  return { action: "deny" };
}

/**
 * Microphone is the only permission ever granted, and only while push-to-talk
 * is armed by a real user gesture (S7: no always-on mic). The gate is armed by
 * main-process input events (before-input-event), not by renderer claims.
 */
export class MicGate {
  private armedUntil = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = 1500,
  ) {}

  /** Call from main-process input handling when the push-to-talk key goes down. */
  arm(): void {
    this.armedUntil = this.now() + this.windowMs;
  }

  disarm(): void {
    this.armedUntil = 0;
  }

  isArmed(): boolean {
    return this.armedUntil > 0 && this.now() < this.armedUntil;
  }
}

export interface PermissionQuery {
  permission: string;
  requestingUrl: string;
  isMainFrame: boolean;
  mediaTypes?: ReadonlyArray<string>;
}

/** setPermissionRequestHandler / setPermissionCheckHandler decision. Default deny. */
export function permissionDecision(q: PermissionQuery, mic: MicGate): boolean {
  if (q.permission !== "media") return false;
  if (!q.isMainFrame || !isAppUrl(q.requestingUrl)) return false;
  const types = q.mediaTypes ?? [];
  if (types.length === 0 || types.some((t) => t !== "audio")) return false; // audio only, never video/screen
  return mic.isArmed();
}

/** The push-to-talk key. Main process watches for it via before-input-event. */
export const PUSH_TO_TALK_KEY = "F9";

/** Hosts the app may ever contact. Empty in Phase 0: no network at all. */
export const NETWORK_ALLOWLIST: readonly string[] = Object.freeze([]);

/** session.webRequest filter: block every request that is not to our own origin. */
export function allowRequest(url: string): boolean {
  if (isAppUrl(url)) return true;
  if (url.startsWith("devtools://")) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && NETWORK_ALLOWLIST.includes(u.hostname);
  } catch {
    return false;
  }
}
