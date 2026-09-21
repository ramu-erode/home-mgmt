import baseConfig from "../../eslint.config.mjs";

export default [
    ...baseConfig,
    {
        // The repository layer in src/db/ is the only code that talks to the
        // database, so `deleted_at IS NULL`, the advisory lock and tombstoning
        // cannot be bypassed from a controller or service (ADR-016).
        // src/testing/ is the one other exception: the test harness creates
        // and inspects databases, and is excluded from the build.
        files: ["**/*.ts"],
        ignores: ["src/db/**", "src/testing/**"],
        rules: {
            "no-restricted-imports": ["error", {
                paths: [
                    { name: "kysely", message: "Only src/db/ may import kysely (ADR-016)." },
                    { name: "pg", message: "Only src/db/ may import pg (ADR-016)." }
                ]
            }]
        }
    }
];
