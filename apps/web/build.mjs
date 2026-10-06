// Static web build for play4m3.com: copies public/ and bundles src/main.ts to
// dist/app.js. No inline script or style, so the strict CSP in vercel.json holds.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const dist = new URL("./dist/", import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL("./public/", import.meta.url), dist, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
  logLevel: "info",
  entryPoints: [new URL("./src/main.ts", import.meta.url).pathname],
  outfile: new URL("./app.js", dist).pathname,
});
