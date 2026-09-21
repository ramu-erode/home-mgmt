import nx from "@nx/eslint-plugin";

export default [
    ...nx.configs["flat/base"],
    ...nx.configs["flat/typescript"],
    ...nx.configs["flat/javascript"],
    {
      "ignores": [
        "**/dist",
        "**/out-tsc",
        "**/vitest.config.*.timestamp*"
      ]
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx"
        ],
        rules: {
            "@nx/enforce-module-boundaries": [
                "error",
                {
                    enforceBuildableLibDependency: true,
                    allow: [
                        "^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"
                    ],
                    depConstraints: [
                        // ---- type: which kinds of project may depend on which
                        // Apps and e2e suites consume libraries; nothing depends on an app.
                        { sourceTag: "type:app", onlyDependOnLibsWithTags: ["type:lib"] },
                        { sourceTag: "type:e2e", onlyDependOnLibsWithTags: ["type:lib"] },
                        { sourceTag: "type:lib", onlyDependOnLibsWithTags: ["type:lib"] },

                        // ---- scope: the rule ADR-003 depends on
                        //
                        // libs/core is the projection engine: project(), cashflow(),
                        // sinkingFund(). ADR-003 requires it to stay pure TypeScript with
                        // no I/O and no framework imports, so it can run client-side in v1
                        // and move to the server unchanged.
                        //
                        // allowedExternalImports is a WHITELIST, not a ban list. Anything
                        // not named here fails lint — including every HTTP client, ORM and
                        // filesystem wrapper, and both frameworks, without having to
                        // enumerate them. Adding an entry should be a deliberate act.
                        //
                        //   rrule  — recurrence expansion (ADR-003 RRULE kind)
                        //   vitest — test files only; specs live inside the project
                        //
                        // A date library goes here if and when one is chosen.
                        {
                            sourceTag: "scope:core",
                            onlyDependOnLibsWithTags: ["scope:shared"],
                            allowedExternalImports: ["rrule", "vitest"]
                        },

                        // libs/shared is DTOs and types. It depends on nothing at all —
                        // an empty array means no workspace library may be imported.
                        {
                            sourceTag: "scope:shared",
                            onlyDependOnLibsWithTags: [],
                            allowedExternalImports: ["vitest"]
                        },

                        // Apps may use both libraries, and each other's? No: api and web
                        // share only through libs, never directly.
                        { sourceTag: "scope:api", onlyDependOnLibsWithTags: ["scope:core", "scope:shared"] },
                        { sourceTag: "scope:web", onlyDependOnLibsWithTags: ["scope:core", "scope:shared"] }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.js",
            "**/*.jsx",
            "**/*.cjs",
            "**/*.mjs"
        ],
        // Override or add rules here
        rules: {}
    }
];
