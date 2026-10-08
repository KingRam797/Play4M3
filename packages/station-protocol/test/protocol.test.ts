import { describe, expect, it } from "vitest";
import { STATION_REQUESTS } from "../src/index.js";

describe("station request schemas", () => {
  it.each([
    ["station:attest", { accepted: false }],
    ["station:attest", {}],
    ["station:project.create", { name: "" }],
    ["station:project.create", { name: "../../etc/passwd" }],
    ["station:project.create", { name: "<script>" }],
    ["station:project.create", { name: "a".repeat(81) }],
    ["station:project.select", { id: "../x" }],
    ["station:function.select", { id: "fn 1" }],
    ["station:command", { text: "" }],
    ["station:command", { text: "x".repeat(501) }],
    ["station:approval.decide", { requestId: "req_1", decision: "approve_all" }],
    ["station:approval.decide", { requestId: "req_1", decision: "approve", token: "forged" }],
    ["station:state", { extra: 1 }],
  ] as const)("%s rejects %j", (channel, payload) => {
    expect(STATION_REQUESTS[channel].safeParse(payload).success).toBe(false);
  });

  it.each([
    ["station:attest", { accepted: true }],
    ["station:project.create", { name: "Sky Hopper mods (v2)" }],
    ["station:project.create", { name: "Café 2" }],
    ["station:command", { text: "make the jump higher" }],
    ["station:approval.decide", { requestId: "req_1", decision: "reject" }],
  ] as const)("%s accepts %j", (channel, payload) => {
    expect(STATION_REQUESTS[channel].safeParse(payload).success).toBe(true);
  });
});
