// Sandboxed preload. Exposes a closed, typed API; never ipcRenderer itself.
import { contextBridge, ipcRenderer } from "electron";

const api = Object.freeze({
  ping: (nonce: string): Promise<{ pong: string; version: string }> => ipcRenderer.invoke("station:ping", { nonce }),
  brand: (): Promise<{ name: string; stationName: string }> => ipcRenderer.invoke("station:brand", {}),
});

contextBridge.exposeInMainWorld("station", api);
