import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Flat-Config (ESLint 9). Gelintet wird nur die TypeScript-Neuauflage in src/.
// Das Legacy-JS, der Build-Output und die Assets bleiben aussen vor.
export default tseslint.config(
  {
    ignores: ["dist/**", "legacy/**", "node_modules/**", "public/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      // TypeScript prüft undefinierte Bezeichner bereits selbst.
      "no-undef": "off",
      // Als Warnung statt Fehler – blockiert die CI nicht, bleibt aber sichtbar.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Entwickler-Werkzeuge (Benchmarks, Asset-/Credits-Generatoren) laufen in Node, nicht im
    // Browser, und sind keine Spiel-Auslieferung. Gleiche relaxte Unused-Regel wie src/, dazu
    // Node-Globals (process/Buffer/console) – damit `npm run lint` über das GANZE Repo grün wird.
    files: ["tools/**/*.{ts,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
