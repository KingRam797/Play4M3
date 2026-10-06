// Builds a single self-contained HTML preview: node packages/loading-screen/preview/build.mjs <out.html>
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "preview.html";
const here = new URL(".", import.meta.url);
const res = await build({ bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", minify: true, legalComments: "none", entryPoints: [new URL("main.ts", here).pathname] });
const js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync(new URL("template.html", here), "utf8").replace("/*__BUNDLE__*/", () => js);
writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes)`);
