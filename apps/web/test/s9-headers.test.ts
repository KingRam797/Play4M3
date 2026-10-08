// S9 (config half): the headers Vercel serves for play4m3.com. The live-header
// check against a deployed preview is a separate CI job (not built yet).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface VercelConfig {
  outputDirectory: string;
  installCommand: string;
  buildCommand: string;
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
}
const cfg = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as VercelConfig;
const all = cfg.headers.find((h) => h.source === "/(.*)");
const header = (k: string) => all?.headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? "";

describe("S9 web headers (vercel.json)", () => {
  it("applies to every path", () => {
    expect(all).toBeDefined();
  });

  it("CSP has no unsafe-inline/eval, no wildcards, no remote origins, and forbids framing", () => {
    const csp = header("Content-Security-Policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|\*|https?:\/\//);
  });

  it("sends HSTS, nosniff and a strict referrer policy", () => {
    expect(header("Strict-Transport-Security")).toMatch(/max-age=(\d+)/);
    expect(Number(/max-age=(\d+)/.exec(header("Strict-Transport-Security"))?.[1])).toBeGreaterThanOrEqual(31536000);
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toMatch(/^(no-referrer|strict-origin|strict-origin-when-cross-origin|same-origin)$/);
  });

  it("denies camera and microphone on the web build", () => {
    expect(header("Permissions-Policy")).toContain("camera=()");
    expect(header("Permissions-Policy")).toContain("microphone=()");
  });

  it("builds only the web app, with a pinned pnpm, and skips the Electron download", () => {
    expect(cfg.outputDirectory).toBe("apps/web/dist");
    expect(cfg.installCommand).toContain("pnpm@10.28.0");
    expect(cfg.installCommand).toContain("--frozen-lockfile");
    expect(cfg.installCommand).toContain("ELECTRON_SKIP_BINARY_DOWNLOAD=1");
    expect(cfg.buildCommand).toContain("--filter @play4m3/web build");
  });

  it("static pages carry no inline script, inline style, or remote resources (CSP would block them)", () => {
    const dir = new URL("../public/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
      const html = readFileSync(new URL(f, dir), "utf8");
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toMatch(/(src|href)="(https?:)?\/\//i);
    }
  });
});
