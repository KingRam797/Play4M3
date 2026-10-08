// Fake secrets are assembled at runtime so the literals never sit in the repo
// (the repo secret scan would rightly flag them).
import { describe, expect, it } from "vitest";
import { REDACTED, findSecrets, redactSecrets } from "../src/secrets.js";

const fake = {
  anthropic: ["sk", "ant", "api03", "A".repeat(40)].join("-"),
  openai: ["sk", "proj", "B".repeat(48)].join("-"),
  github: ["ghp", "C".repeat(36)].join("_"),
  aws: "AKIA" + "D".repeat(16),
  pem: ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
};

describe("secret patterns", () => {
  it.each(Object.entries(fake))("detects %s", (_k, secret) => {
    expect(findSecrets(`config value = ${secret} end`).length).toBeGreaterThan(0);
  });

  it("redacts every occurrence", () => {
    const text = `a ${fake.anthropic} b ${fake.anthropic} c ${fake.github}`;
    const out = redactSecrets(text);
    expect(out).not.toContain(fake.anthropic);
    expect(out).not.toContain(fake.github);
    expect(out.split(REDACTED).length - 1).toBe(3);
  });

  it("leaves ordinary text alone", () => {
    expect(findSecrets("function sk_update(task) { return skill-anthology; }")).toEqual([]);
  });
});
