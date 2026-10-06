// Standalone preview of the loading screen (web build / design review).
// DEMO ONLY: the progress here is simulated on a timer because there is no real
// work to load in a static preview. The desktop app drives progress from real
// startup steps (apps/desktop/src/renderer/boot.ts).
import { BRAND } from "@play4m3/core/brand";
import { startLoadingScreen } from "../src/index.js";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const live = document.getElementById("live") as HTMLDivElement;
const done = document.getElementById("done") as HTMLElement;

function run(): void {
  document.body.dataset["loading"] = "loading";
  done.hidden = true;
  canvas.hidden = false;
  const screen = startLoadingScreen({
    canvas,
    title: BRAND.name,
    subtitle: BRAND.stationName,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    announce: (m) => {
      live.textContent = m;
    },
  });
  const steps = ["Waking the station", "Loading skills", "Warming up voice", "Checking signatures", "Almost there"];
  let p = 0;
  const timer = setInterval(() => {
    p = Math.min(1, p + 0.012 + Math.random() * 0.02);
    screen.setProgress(p, steps[Math.min(steps.length - 1, Math.floor(p * steps.length))]);
    if (p >= 1) {
      clearInterval(timer);
      screen.markReady();
      document.body.dataset["loading"] = "ready";
    }
  }, 120);
  void screen.continued.then(() => {
    screen.dispose();
    document.body.dataset["loading"] = "done";
    canvas.hidden = true;
    done.hidden = false;
  });
}

(document.getElementById("again") as HTMLButtonElement).addEventListener("click", run);
run();
