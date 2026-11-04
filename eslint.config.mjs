import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A server action bound with useActionState receives (prev, formData) by position, so one
    // that needs neither still has to declare them. The underscore prefix is how this codebase
    // already says "deliberately unused" — honour it, rather than leave standing warnings that
    // train everyone to scroll past the lint output.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // A .cjs file IS CommonJS, by extension. require() is not a style choice there, it is the
    // only thing that works: scripts/ensure-app-role.cjs runs as the container's entrypoint
    // before Next or any bundler exists.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
