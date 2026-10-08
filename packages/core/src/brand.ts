// Single source of truth for the product name (brief §2.4).
// The name is NOT cleared yet. Legal docs, privacy policy and Store metadata
// must use the {{BRAND}} placeholder and be rendered through renderBrand()
// only after King clears the name (docs/OPEN_QUESTIONS.md, BLOCKED-HUMAN).
export const BRAND = {
  name: "Play4M3",
  domain: "play4m3.com",
  secondaryDomain: "play4m3.si",
  stationName: "The Creation Station",
  nameCleared: false,
} as const;

export const BRAND_PLACEHOLDER = "{{BRAND}}";

/** Replaces {{BRAND}} placeholders. Refuses to run on legal text until the name is cleared. */
export function renderBrand(template: string, opts: { legal: boolean }): string {
  if (opts.legal && !BRAND.nameCleared) {
    return template;
  }
  return template.split(BRAND_PLACEHOLDER).join(BRAND.name);
}
