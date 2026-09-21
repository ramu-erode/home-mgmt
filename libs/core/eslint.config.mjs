import baseConfig from "../../eslint.config.mjs";

export default [
    ...baseConfig,
    {
        // A due date is a calendar day, not an instant. JS Date turns one into
        // the other and shifts it by timezone (ADR-013). Use the civil-date
        // helper; take `today` as a parameter.
        files: ["**/*.ts"],
        rules: {
            "no-restricted-globals": ["error", {
                name: "Date",
                message: "No JS Date in libs/core — use the CivilDate helper (ADR-013)."
            }]
        }
    },
    {
        files: [
            "**/*.json"
        ],
        rules: {
      "@nx/dependency-checks": [
        "error",
        {
          "ignoredFiles": [
            "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
            "{projectRoot}/vitest.config.{js,ts,mjs,mts}"
          ]
        }
      ]
    },
        languageOptions: {
            parser: await import("jsonc-eslint-parser")
        }
    }
];
