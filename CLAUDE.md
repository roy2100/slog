# CLAUDE.md — slog

Guidance for Claude Code working in this repository. Read before editing.

## What this is

`slog` is a structured logger delivered as **one vendorable TypeScript file** (`slog.ts`).
Users copy that single file into their project (e.g. `vendor/slog.ts`) and import it.
Target use case: single-machine, personal apps. Logs are optimized for an AI agent to
read and diagnose problems, and disk usage stays bounded over long runs.

## Hard constraints — do not violate

These are the product. Breaking any of them defeats the point of the project:

1. **`slog.ts` stays a single file.** No splitting into modules, no `src/` tree. Everything
   ships in that one file.
2. **Zero runtime dependencies.** Only `node:*` built-ins may be imported in `slog.ts`.
   Never add a runtime dependency to `package.json`. (`@types/node` + `typescript` are
   dev-only and fine.)
3. **Node.js >= 24 only.** Use native TS execution (`node slog.ts`) and modern built-ins
   (e.g. `util.styleText`). No transpile/build step, no backward-compat shims.
4. **Logging must never crash the host app.** All file I/O is wrapped in try/catch that
   swallows errors. Keep it that way — a failed write must not throw into user code.
5. **Output stays machine-parseable NDJSON.** One self-contained JSON object per line.
   The first line of every file is a `{ "_meta": "slog", ... }` schema header; every other
   line is a record. Do not introduce multi-line records or non-JSON file output.
6. **Disk stays bounded.** Size rotation + gzip + retention pruning must hold worst-case
   disk to ~`maxFileSize * (maxFiles + 1)` regardless of uptime. Don't add unbounded growth.

## Layout

- `slog.ts` — the entire library. Public API: `createLogger(options?)` (default + named
  export), `Logger`, types `Level` / `LogRecord` / `SlogOptions` / `SerializedError`.
- `examples/demo.ts` — smoke test exercising levels, `child`, errors, forced rotation.
- `docs/plan-slog.md` — design doc and rationale. Update its `## Outcome` after changes.
- `tsconfig.json` — `nodenext`, `allowImportingTsExtensions`, `strict`. Imports use the
  `.ts` extension (required by Node's native TS loader).

## Workflow

- Verify every change with both:
  - `npm run typecheck` — must exit 0 (strict mode).
  - `npm run demo` — must run clean and produce valid NDJSON under `./logs/`.
- `logs/` and `node_modules/` are gitignored; never commit them.
- Keep usage docs **inside the code** (top-of-file quickstart + JSDoc on exports), so an
  agent that opens `slog.ts` learns the API without a separate README. Update them when the
  API changes.
- When a change is non-trivial, follow the global rule: write/update the plan in `docs/`
  first, then implement.

## Out of scope (by design)

Network/remote transport, log shipping, multi-process aggregation, browser runtime,
field redaction/PII scrubbing, sampling/rate limiting. If a request needs one of these,
flag the scope change before adding it.
