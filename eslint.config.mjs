import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,

  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },

      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        Image: "readonly",
		Audio: "readonly",
        createImageBitmap: "readonly",
        cancelAnimationFrame: "readonly",

        // Node globals
        console: "readonly",

        // Modern JS globals
        structuredClone: "readonly"
      }
    }
  },

  {
    ignores: [
      "node_modules/**",
      "scripts/**",
      "dist/**",
      "build/**",
      "release/**",
      "**/*.min.js",
      "main.js"
    ]
  }
]);