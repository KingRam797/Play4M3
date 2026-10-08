// Sandboxed preload. Exposes a closed, typed API; never ipcRenderer itself.
// Every method maps to exactly one validated channel in ipc.ts.
import { contextBridge, ipcRenderer } from "electron";

const api = Object.freeze({
  ping: (nonce: string): Promise<{ pong: string; version: string }> => ipcRenderer.invoke("station:ping", { nonce }),
  brand: (): Promise<{ name: string; stationName: string }> => ipcRenderer.invoke("station:brand", {}),
  state: (): Promise<unknown> => ipcRenderer.invoke("station:state", {}),
  attest: (): Promise<unknown> => ipcRenderer.invoke("station:attest", { accepted: true }),
  createProject: (name: string): Promise<unknown> => ipcRenderer.invoke("station:project.create", { name }),
  selectProject: (id: string): Promise<unknown> => ipcRenderer.invoke("station:project.select", { id }),
  selectFunction: (id: string): Promise<unknown> => ipcRenderer.invoke("station:function.select", { id }),
  command: (text: string): Promise<unknown> => ipcRenderer.invoke("station:command", { text }),
  decide: (requestId: string, decision: "approve" | "reject"): Promise<unknown> => ipcRenderer.invoke("station:approval.decide", { requestId, decision }),
});

contextBridge.exposeInMainWorld("station", api);
