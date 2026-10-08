import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/coverage/**", "apps/desktop/renderer/boot.js"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Security: never build code from strings.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["packages/loading-screen/src/**/*.ts", "packages/loading-screen/preview/**/*.ts", "apps/desktop/src/renderer/**/*.ts", "apps/web/src/**/*.ts", "apps/station/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // End-to-end scripts run in Node but pass callbacks that execute in the page.
    files: ["apps/*/e2e/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["apps/*/renderer/**/*.js"],
    languageOptions: { globals: { ...globals.browser }, sourceType: "script" },
  },
);
