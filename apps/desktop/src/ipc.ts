// S8: every IPC message is Zod-validated and sender-checked. The channel list
// is closed; anything else is dropped. Handlers never receive raw renderer input.
import { z } from "zod";
import { isAppUrl } from "./security.js";

export const IPC_CHANNELS = {
  "station:ping": {
    request: z.object({ nonce: z.string().regex(/^[A-Za-z0-9]{1,32}$/) }).strict(),
    response: z.object({ pong: z.string(), version: z.string() }).strict(),
  },
  "station:brand": {
    request: z.object({}).strict(),
    response: z.object({ name: z.string(), stationName: z.string() }).strict(),
  },
} as const;

export type Channel = keyof typeof IPC_CHANNELS;
export type IpcRequest<C extends Channel> = z.infer<(typeof IPC_CHANNELS)[C]["request"]>;
export type IpcResponse<C extends Channel> = z.infer<(typeof IPC_CHANNELS)[C]["response"]>;

export function isChannel(name: unknown): name is Channel {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(IPC_CHANNELS, name);
}

export type IpcCheck<C extends Channel> = { ok: true; value: IpcRequest<C> } | { ok: false; reason: string };

/** Validates sender and payload. `senderUrl` is the sending frame's URL; `isMainFrame` from the event. */
export function checkIpc<C extends Channel>(channel: C, senderUrl: string, isMainFrame: boolean, payload: unknown): IpcCheck<C> {
  if (!isMainFrame) return { ok: false, reason: "ipc from subframe" };
  if (!isAppUrl(senderUrl)) return { ok: false, reason: "ipc from foreign origin" };
  const parsed = IPC_CHANNELS[channel].request.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "ipc payload failed schema" };
  return { ok: true, value: parsed.data as IpcRequest<C> };
}
