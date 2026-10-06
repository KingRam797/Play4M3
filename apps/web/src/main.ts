// play4m3.com entry: the destructible loading screen, then the landing content.
// Progress follows real page work (document load, fonts); nothing is simulated.
// The web build never analyzes binaries (brief §2.2).
import { BRAND } from "@play4m3/core/brand";
import { startLoadingScreen } from "@play4m3/loading-screen";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

async function main(): Promise<void> {
  const live = el<HTMLDivElement>("live");
  const screen = startLoadingScreen({
    canvas: el<HTMLCanvasElement>("stage"),
    title: BRAND.name,
    subtitle: BRAND.stationName,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    announce: (m) => {
      live.textContent = m;
    },
  });
  screen.setProgress(0.3, "Loading page");
  if (document.readyState !== "complete") await new Promise<void>((r) => window.addEventListener("load", () => r(), { once: true }));
  screen.setProgress(0.7, "Loading fonts");
  await document.fonts.ready;
  screen.markReady();
  document.body.dataset["loading"] = "ready";

  await screen.continued;
  screen.dispose();
  document.body.dataset["loading"] = "done";
  el<HTMLElement>("app").hidden = false;
}

void main();
