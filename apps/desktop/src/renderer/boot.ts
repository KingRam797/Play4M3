// Renderer entry: shows the destructible loading screen while the app does its
// real startup work, waits for the player to press A (gamepad), Enter or the
// on-screen A, then mounts the Creation Station. No Node, no inline script (CSP).
import { BRAND } from "@play4m3/core/brand";
import { startLoadingScreen } from "@play4m3/loading-screen";
import { mountStation } from "@play4m3/station";
import { ViewStateSchema } from "@play4m3/station-protocol";
import type { StationApi, ViewState } from "@play4m3/station-protocol";

interface StationBridge {
  ping(nonce: string): Promise<{ pong: string; version: string }>;
  brand(): Promise<{ name: string; stationName: string }>;
  state(): Promise<unknown>;
  attest(): Promise<unknown>;
  createProject(name: string): Promise<unknown>;
  selectProject(id: string): Promise<unknown>;
  selectFunction(id: string): Promise<unknown>;
  command(text: string): Promise<unknown>;
  decide(requestId: string, decision: "approve" | "reject"): Promise<unknown>;
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

/** Wraps the preload bridge and validates every view state the main process sends back. */
function stationApi(b: StationBridge): StationApi {
  const v = async (p: Promise<unknown>): Promise<ViewState> => ViewStateSchema.parse(await p);
  return {
    state: () => v(b.state()),
    attest: () => v(b.attest()),
    createProject: (name) => v(b.createProject(name)),
    selectProject: (id) => v(b.selectProject(id)),
    selectFunction: (id) => v(b.selectFunction(id)),
    command: (text) => v(b.command(text)),
    decide: (id, d) => v(b.decide(id, d)),
  };
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
  let brand: { name: string; stationName: string } = { name: BRAND.name, stationName: BRAND.stationName };
  try {
    screen.setProgress(0.1, "Connecting");
    brand = await window.station.brand();
    screen.setProgress(0.4, "Checking the bridge");
    const r = await window.station.ping("hello");
    out.textContent = r.pong === "hello" ? `ok (v${r.version})` : "mismatch";
    screen.setProgress(0.7, "Opening the Station");
    await window.station.state();
    screen.setProgress(0.9, "Loading fonts");
    await document.fonts.ready;
  } catch {
    out.textContent = "failed";
  }
  screen.markReady();
  document.body.dataset["loading"] = "ready";

  await screen.continued;
  screen.dispose();
  document.body.dataset["loading"] = "done";
  const root = el<HTMLDivElement>("station-root");
  root.hidden = false;
  mountStation(root, stationApi(window.station), brand);
}

void main();
