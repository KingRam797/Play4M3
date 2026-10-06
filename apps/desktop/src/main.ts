// Electron main process: Phase 0 hardened hello-world shell (S8) and MSIX spike.
// All security values come from ./security.ts; the S8 audit test scans this file.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app, ipcMain, protocol, session } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { BRAND, canonicalizeRelative } from "@play4m3/core";
import { IPC_CHANNELS, checkIpc } from "./ipc.js";
import type { Channel, IpcRequest, IpcResponse } from "./ipc.js";
import {
  APP_HOST,
  APP_ORIGIN,
  APP_SCHEME,
  MicGate,
  PUSH_TO_TALK_KEY,
  RESPONSE_HEADERS,
  WEB_PREFERENCES,
  allowNavigation,
  allowRequest,
  permissionDecision,
  windowOpenDecision,
} from "./security.js";

const RENDERER_DIR = path.join(__dirname, "..", "renderer");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const mic = new MicGate();

if (!app.requestSingleInstanceLock()) app.quit();

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves bundled renderer files only. Paths go through the same canonicalizer as the policy engine. */
async function serveApp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== APP_HOST || request.method !== "GET") return new Response(null, { status: 404 });
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const canon = canonicalizeRelative(rel);
  const ext = canon.ok ? path.extname(canon.path) : "";
  const mime = MIME[ext];
  if (!canon.ok || !mime) return new Response(null, { status: 404 });
  try {
    const body = await readFile(path.join(RENDERER_DIR, ...canon.segments));
    return new Response(body, { status: 200, headers: { ...RESPONSE_HEADERS, "Content-Type": mime } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function lockDownContents(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (!allowNavigation(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!allowNavigation(url)) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (!allowNavigation(event.url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => windowOpenDecision());
  // Push-to-talk is armed only by real key input seen by the main process.
  contents.on("before-input-event", (_event, input) => {
    if (input.key !== PUSH_TO_TALK_KEY) return;
    if (input.type === "keyDown") mic.arm();
    if (input.type === "keyUp") mic.disarm();
  });
}

function handle<C extends Channel>(channel: C, fn: (req: IpcRequest<C>) => IpcResponse<C>): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
    const frame = event.senderFrame;
    const check = checkIpc(channel, frame?.url ?? "", frame !== null && frame === event.sender.mainFrame, payload);
    if (!check.ok) throw new Error("rejected");
    return IPC_CHANNELS[channel].response.parse(fn(check.value));
  });
}

app.on("web-contents-created", (_event, contents) => lockDownContents(contents));

app.whenReady().then(() => {
  const ses = session.defaultSession;
  protocol.handle(APP_SCHEME, serveApp);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(permissionDecision({ permission, requestingUrl: details.requestingUrl, isMainFrame: details.isMainFrame, mediaTypes }, mic) && wc.getURL().startsWith(APP_ORIGIN));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    permissionDecision({ permission, requestingUrl: details.requestingUrl ?? requestingOrigin, isMainFrame: details.isMainFrame ?? false, mediaTypes: details.mediaType ? [details.mediaType] : [] }, mic),
  );
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_req, callback) => callback({}));
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowRequest(details.url) }));

  handle("station:ping", (req) => ({ pong: req.nonce, version: app.getVersion() }));
  handle("station:brand", () => ({ name: BRAND.name, stationName: BRAND.stationName }));

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: BRAND.stationName,
    show: false,
    webPreferences: { ...WEB_PREFERENCES, preload: path.join(__dirname, "preload.cjs") },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  void win.loadURL(`${APP_ORIGIN}/index.html`);

  // CI smoke test: report what the renderer's bridge check shows, then quit.
  // Reads one text node; grants nothing.
  if (process.env["P4M3_SMOKE"] === "1") {
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void win.webContents
          .executeJavaScript("[document.getElementById('ping').textContent, typeof require, typeof process, typeof window.station.ping].join('|')", false)
          .then((result: unknown) => {
            const [ping, req, proc, bridge] = String(result).split("|");
            console.log(`SMOKE ping=${ping} require=${req} process=${proc} bridge=${bridge} sandbox=${String(win.webContents.getLastWebPreferences()?.sandbox)}`);
            const ok = ping === `ok (v${app.getVersion()})` && req === "undefined" && proc === "undefined" && bridge === "function";
            app.exit(ok ? 0 : 1);
          });
      }, 1500);
    });
  }
});

app.on("window-all-closed", () => app.quit());
