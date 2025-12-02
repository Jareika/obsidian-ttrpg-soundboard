// eslint.config.cjs – Flat Config für ESLint 9+

const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const globals = require("globals");

/** @type {import("eslint").Linter.FlatConfig[]} */
module.exports = [
  // Globale Ignore-Regeln
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "main.js",
      ".obsidian/**"
    ]
  },

  // TypeScript-Regeln für alle .ts-Dateien
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest"
        // Wenn du später strengere, typbasierte Regeln willst:
        // project: "./tsconfig.json",
        // tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      // Basis: empfohlene TS-Regeln
      ...tsPlugin.configs.recommended.rules,

      // Dinge, die im Plugin eher nerven können:
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off"
    }
  }
];