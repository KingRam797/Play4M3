// S8: automated Electron config audit. The manual checklist lives in docs/SECURITY.md.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkIpc, isChannel } from "../src/ipc.js";
import { CSP, MicGate, RESPONSE_HEADERS, WEB_PREFERENCES, allowNavigation, allowRequest, isAppUrl, permissionDecision, windowOpenDecision } from "../src/security.js";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const renderer = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), "utf8");

describe("S8 webPreferences", () => {
  it("has the required hardening flags", () => {
    expect(WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
    });
    expect(Object.isFrozen(WEB_PREFERENCES)).toBe(true);
  });

  it("main.ts spreads WEB_PREFERENCES and never overrides a hardening flag", () => {
    const main = src("main.ts");
    expect(main).toContain("webPreferences: { ...WEB_PREFERENCES, preload:");
    for (const bad of [/nodeIntegration\s*:\s*true/, /contextIsolation\s*:\s*false/, /sandbox\s*:\s*false/, /webSecurity\s*:\s*false/, /allowRunningInsecureContent\s*:\s*true/, /webviewTag\s*:\s*true/, /enableRemoteModule/, /--no-sandbox/, /disable-web-security/]) {
      expect(main, String(bad)).not.toMatch(bad);
    }
  });

  it("main.ts loads only the app origin and installs every guard", () => {
    const main = src("main.ts");
    expect(main).not.toMatch(/loadURL\(\s*["'`]https?:/);
    expect(main).not.toMatch(/loadFile\(/);
    expect(main).not.toMatch(/shell\.openExternal/);
    for (const hook of ["will-navigate", "will-redirect", "will-frame-navigate", "will-attach-webview", "setWindowOpenHandler", "setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler", "setDisplayMediaRequestHandler", "onBeforeRequest", "web-contents-created", "app.enableSandbox()"]) {
      expect(main, hook).toContain(hook);
    }
  });

  it("preload exposes a closed API and never ipcRenderer itself", () => {
    const preload = src("preload.ts");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
    expect(preload).not.toMatch(/ipcRenderer\.(on|send|sendSync)\b/);
  });
});

describe("S8 CSP and headers", () => {
  it("CSP forbids inline, eval and remote sources", () => {
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("base-uri 'none'");
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|\*|https?:|data:.*script/);
  });

  it("response headers include CSP, nosniff and strict referrer", () => {
    expect(RESPONSE_HEADERS["Content-Security-Policy"]).toBe(CSP);
    expect(RESPONSE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(RESPONSE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
  });

  it("renderer HTML has a CSP meta, no inline script/style, no inline handlers, no remote URLs", () => {
    for (const f of readdirSync(new URL("../renderer/", import.meta.url)).filter((x) => x.endsWith(".html"))) {
      const html = renderer(f);
      expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toMatch(/(src|href)="(https?:)?\/\//i);
    }
  });
});

describe("S8 navigation, window.open, network", () => {
  it.each([
    ["app://station/index.html", true],
    ["app://station/", true],
    ["app://evil/index.html", false],
    ["app://user:pw@station/", false],
    ["app://station:8080/", false],
    ["https://play4m3.com/", false],
    ["http://station/", false],
    ["file:///C:/Windows/System32/", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>1</script>", false],
    ["about:blank", false],
    ["not a url", false],
  ] as const)("navigation to %s => %s", (url, ok) => {
    expect(allowNavigation(url)).toBe(ok);
    expect(isAppUrl(url)).toBe(ok);
  });

  it("window.open is always denied", () => {
    expect(windowOpenDecision()).toEqual({ action: "deny" });
  });

  it("all network requests except the app origin are blocked in Phase 0", () => {
    expect(allowRequest("app://station/renderer.js")).toBe(true);
    for (const u of ["https://api.anthropic.com/v1/messages", "https://play4m3.com", "http://127.0.0.1:11434", "ws://localhost", "devtools://devtools/x", "file:///etc/passwd"]) {
      expect(allowRequest(u), u).toBe(false);
    }
  });
});

describe("S8 permissions (S7 push-to-talk overlap)", () => {
  const appUrl = "app://station/index.html";

  it("denies every permission except microphone", () => {
    const gate = new MicGate(() => 0);
    gate.arm();
    for (const p of ["geolocation", "notifications", "midi", "midiSysex", "pointerLock", "fullscreen", "openExternal", "clipboard-read", "clipboard-sanitized-write", "display-capture", "hid", "serial", "usb", "idle-detection", "window-management", "unknown"]) {
      expect(permissionDecision({ permission: p, requestingUrl: appUrl, isMainFrame: true }, gate), p).toBe(false);
    }
  });

  it("grants audio only while push-to-talk is armed", () => {
    let t = 0;
    const gate = new MicGate(() => t, 1500);
    const q = { permission: "media", requestingUrl: appUrl, isMainFrame: true, mediaTypes: ["audio"] };
    expect(permissionDecision(q, gate)).toBe(false);
    gate.arm();
    expect(permissionDecision(q, gate)).toBe(true);
    t = 2000;
    expect(permissionDecision(q, gate)).toBe(false);
    gate.arm();
    gate.disarm();
    expect(permissionDecision(q, gate)).toBe(false);
  });

  it("never grants video, screen, subframes or foreign origins even when armed", () => {
    const gate = new MicGate(() => 0);
    gate.arm();
    expect(permissionDecision({ permission: "media", requestingUrl: appUrl, isMainFrame: true, mediaTypes: ["video"] }, gate)).toBe(false);
    expect(permissionDecision({ permission: "media", requestingUrl: appUrl, isMainFrame: true, mediaTypes: ["audio", "video"] }, gate)).toBe(false);
    expect(permissionDecision({ permission: "media", requestingUrl: appUrl, isMainFrame: true, mediaTypes: [] }, gate)).toBe(false);
    expect(permissionDecision({ permission: "media", requestingUrl: appUrl, isMainFrame: false, mediaTypes: ["audio"] }, gate)).toBe(false);
    expect(permissionDecision({ permission: "media", requestingUrl: "https://evil.example/", isMainFrame: true, mediaTypes: ["audio"] }, gate)).toBe(false);
  });
});

describe("S8 IPC validation", () => {
  const appUrl = "app://station/index.html";

  it("accepts a valid message from the app main frame", () => {
    expect(checkIpc("station:ping", appUrl, true, { nonce: "abc123" })).toEqual({ ok: true, value: { nonce: "abc123" } });
  });

  it.each([
    ["foreign origin", "https://evil.example/", true, { nonce: "a" }],
    ["subframe", appUrl, false, { nonce: "a" }],
    ["extra field", appUrl, true, { nonce: "a", cmd: "rm" }],
    ["wrong type", appUrl, true, { nonce: 1 }],
    ["bad charset", appUrl, true, { nonce: "a;b" }],
    ["too long", appUrl, true, { nonce: "a".repeat(33) }],
    ["null", appUrl, true, null],
    ["array", appUrl, true, ["a"]],
  ] as const)("rejects %s", (_n, url, main, payload) => {
    expect(checkIpc("station:ping", url, main, payload).ok).toBe(false);
  });

  it("only known channels exist", () => {
    expect(isChannel("station:ping")).toBe(true);
    for (const c of ["station:exec", "__proto__", "constructor", "toString", 42]) expect(isChannel(c)).toBe(false);
  });
});

describe("S8 packaging (electron-builder.yml)", () => {
  // Normalize line endings: Windows checkouts may use CRLF.
  const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it.each([
    ["runAsNode", "false"],
    ["enableCookieEncryption", "true"],
    ["enableNodeOptionsEnvironmentVariable", "false"],
    ["enableNodeCliInspectArguments", "false"],
    ["enableEmbeddedAsarIntegrityValidation", "true"],
    ["onlyLoadAppFromAsar", "true"],
    ["grantFileProtocolExtraPrivileges", "false"],
  ])("fuse %s is %s", (fuse, value) => {
    expect(yml).toMatch(new RegExp(`^\\s+${fuse}: ${value}\\s*$`, "m"));
  });

  it("asks for no capabilities beyond runFullTrust and microphone", () => {
    const caps = (yml.match(/capabilities:\n((?:\s+- .+\n)+)/)?.[1] ?? "").split("\n").map((l) => l.trim().replace(/^- /, "")).filter(Boolean);
    expect(caps.sort()).toEqual(["microphone", "runFullTrust"]);
  });

  it("packages with asar and never ships source maps", () => {
    expect(yml).toMatch(/^asar: true$/m);
    expect(yml).toContain('"!**/*.map"');
  });
});

describe("S8 station IPC", () => {
  const appUrl = "app://station/index.html";

  it("every channel the preload invokes is a declared, validated channel", () => {
    const preload = readFileSync(new URL("../src/preload.ts", import.meta.url), "utf8");
    const used = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(9);
    for (const c of used) expect(isChannel(c), c).toBe(true);
  });

  it("main registers a handler for every declared channel and nothing else", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const handled = [...main.matchAll(/handle\("([^"]+)"/g)].map((m) => m[1]).sort();
    const preload = readFileSync(new URL("../src/preload.ts", import.meta.url), "utf8");
    const used = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]).sort();
    expect(handled).toEqual(used);
    expect(main).not.toMatch(/ipcMain\.on\(/);
  });

  it.each([
    ["station:attest", { accepted: false }],
    ["station:project.create", { name: "../../x" }],
    ["station:command", { text: "x".repeat(501) }],
    ["station:approval.decide", { requestId: "req_1", decision: "approve", approvalToken: "forged" }],
    ["station:function.select", { id: "fn 1; rm" }],
  ] as const)("rejects bad %s payload", (channel, payload) => {
    expect(checkIpc(channel, appUrl, true, payload).ok).toBe(false);
  });

  it("main confirms approvals in a native dialog, outside the renderer", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/dialog\.showMessageBox\(win,/);
    expect(main).toMatch(/cancelId: 0/);
    expect(main).toMatch(/defaultId: 0/); // Enter on the dialog cancels; approving needs a deliberate choice
  });
});
