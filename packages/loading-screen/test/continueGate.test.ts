import { describe, expect, it } from "vitest";
import { ContinueGate } from "../src/continueGate.js";

async function settled(p: Promise<void>): Promise<boolean> {
  let done = false;
  void p.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe("ContinueGate: the loading screen only closes on a fresh press after loading", () => {
  it("ignores presses while loading and says why", async () => {
    const g = new ContinueGate();
    expect(g.update(true)).toBe("not-ready");
    expect(g.update(false)).toBe("ignored");
    expect(g.update(true)).toBe("not-ready");
    expect(g.state).toBe("loading");
    expect(await settled(g.done)).toBe(false);
  });

  it("continues on a press after ready", async () => {
    const g = new ContinueGate();
    g.markReady();
    expect(g.update(true)).toBe("continued");
    expect(g.state).toBe("done");
    expect(await settled(g.done)).toBe(true);
  });

  it("never continues without a press, however long it runs", async () => {
    const g = new ContinueGate();
    g.markReady();
    for (let i = 0; i < 10_000; i++) expect(g.update(false)).toBe("ignored");
    expect(g.state).toBe("ready");
    expect(await settled(g.done)).toBe(false);
  });

  it("a button held through the moment loading finishes must be released first", () => {
    const g = new ContinueGate();
    g.update(true); // player is holding A while loading
    g.markReady();
    expect(g.update(true)).toBe("ignored"); // still held: no edge
    expect(g.state).toBe("ready");
    g.update(false);
    expect(g.update(true)).toBe("continued");
  });

  it("a press that started during loading does not count after ready", () => {
    const g = new ContinueGate();
    expect(g.update(true)).toBe("not-ready");
    g.markReady();
    g.update(true); // continuing to hold
    expect(g.state).toBe("ready");
  });

  it("holding the button is one press, not many", () => {
    const g = new ContinueGate();
    g.markReady();
    expect(g.update(true)).toBe("continued");
    for (let i = 0; i < 50; i++) expect(g.update(true)).toBe("ignored");
  });

  it("markReady is idempotent and cannot reopen a finished gate", () => {
    const g = new ContinueGate();
    g.markReady();
    g.update(true);
    g.markReady();
    expect(g.state).toBe("done");
  });
});
