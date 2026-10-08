import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { StationApi } from "@play4m3/station-protocol";
import { App } from "./App.js";

/** Mounts the Station UI. `api` is the only way the UI can affect anything. */
export function mountStation(container: HTMLElement, api: StationApi, brand: { name: string; stationName: string }): () => void {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App api={api} brand={brand} />
    </StrictMode>,
  );
  return () => root.unmount();
}
