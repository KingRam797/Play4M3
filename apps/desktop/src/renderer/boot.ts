// Renderer entry: shows the destructible loading screen while the app does its
// real startup work, then waits for the player to press A (gamepad), Enter or
// the on-screen A before revealing the app. No Node, no inline script (CSP).
import { BRAND } from "@play4m3/core/brand";
import { startLoadingScreen } from "@play4m3/loading-screen";

interface StationBridge {
  ping(nonce: string): Promise<{ pong: string; version: string }>;
  brand(): Promise<{ name: string; stationName: string }>;
}
declare global {
  interface Window {
    station: StationBridge;
  }
}

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

  // Real startup steps. Each one moves the bar; none of them is a timer.
  const out = el<HTMLOutputElement>("ping");
  try {
    screen.setProgress(0.1, "Connecting");
    const brand = await window.station.brand();
    el<HTMLHeadingElement>("title").textContent = brand.stationName;
    screen.setProgress(0.45, "Checking the bridge");
    const r = await window.station.ping("hello");
    out.textContent = r.pong === "hello" ? `ok (v${r.version})` : "mismatch";
    screen.setProgress(0.8, "Loading fonts");
    await document.fonts.ready;
  } catch {
    out.textContent = "failed";
  }
  screen.markReady();
  document.body.dataset["loading"] = "ready";

  await screen.continued;
  screen.dispose();
  document.body.dataset["loading"] = "done";
  el<HTMLElement>("app").hidden = false;
}

void main();
