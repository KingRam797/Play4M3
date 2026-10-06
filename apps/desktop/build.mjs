// Bundles main and preload to CommonJS for Electron, and the renderer boot
// script (loading screen + app shell) to a browser IIFE. Workspace packages are bundled in.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: false, legalComments: "external", logLevel: "info" };
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });
await build({ bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: false, legalComments: "none", logLevel: "info", entryPoints: ["src/renderer/boot.ts"], outfile: "renderer/boot.js" });
