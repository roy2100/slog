# Plan: slog — single-file structured logger

## Goal
Implement a TypeScript logging library delivered as **one vendorable file** (`slog.ts`).
It targets single-machine, personal applications. Its log output is optimized for an AI
agent to read and diagnose problems (stable, self-contained, machine-parseable records),
and it bounds disk usage automatically so a long-running process never fills the disk.

## Scope
Included:
- Single file `slog.ts`, **zero external dependencies** (only `node:*` built-ins),
  targeting **Node.js >= 24** (native TS execution; `util.styleText` for color).
- Structured **NDJSON** file output (one self-contained JSON event per line).
- Human-readable, colorized console output when attached to a TTY.
- Levels: `trace` `debug` `info` `warn` `error` `fatal` with numeric severity.
- Child loggers with bound context; base fields.
- First-class `Error` serialization (name, message, stack, `cause` chain).
- Optional source location (`file:line`) capture.
- Disk safety: size-based rotation, gzip of rotated files, retention by file count
  and by age, automatic pruning.
- Crash-safe: synchronous appends by default so records are not lost on crash;
  flush/close on process exit signals.

Out of scope (documented as future work):
- Network/remote transport, log shipping, multi-process aggregation.
- Field redaction / PII scrubbing (note left as an extension point).
- Browser runtime (this is a Node-targeted file logger; console-only use still works).
- Sampling / rate limiting.

## Design

### Record shape (AI-friendly, NDJSON)
Each file line is one JSON object with a **stable key order**:
```
{ "ts": ISO8601ms, "t": epochMs, "level": "info", "lvl": 30,
  "msg": "...", "pid": 123, "host": "box",
  "ctx": { ...bound + per-call fields },
  "err": { "name","message","stack","cause"? },
  "src": { "file","line","fn"? } }
```
Rationale for AI debugging: one event per line (greppable / streamable), both string and
numeric level (filter + sort), ISO timestamp + epoch (human + machine), error stack inline,
no multi-line wrapping, no ANSI codes in files.

### Public API
```ts
const log = createLogger({ dir: "./logs", level: "info" });
log.info("server started", { port: 8080 });
log.error("db query failed", { err, query });   // Error auto-serialized
const reqLog = log.child({ requestId });          // bound context
```
Level methods: `(msg: string, fields?: Record<string, unknown>) => void`.
Any field whose value is an `Error` is serialized; `fields.err` is the conventional slot.

### Options (with defaults)
- `level` = `"info"`
- `dir` = `"./logs"`, `filename` = `"app"`  → active file `app.log`
- `console` = `"auto"` (on when stdout is a TTY), `pretty` = `"auto"`
- `maxFileSize` = `10 * 1024 * 1024` (10 MB) — rotate when exceeded
- `maxFiles` = `5` — rotated files kept
- `maxAgeDays` = `14` — delete rotated files older than this
- `gzip` = `true` — gzip rotated files
- `captureSource` = `false` — derive `src` from stack (perf cost)
- `base` = `{}` — fields merged into every record
- `sync` = `true` — synchronous appends (crash-safe); `false` = buffered stream

### Disk-bound strategy
1. Maintain a running byte count of the active file.
2. When a write would exceed `maxFileSize`: close → rename to
   `app-YYYYMMDD-HHmmss-SSS.log` → (gzip → `.log.gz`) → reopen fresh `app.log`.
3. Prune: keep newest `maxFiles` rotated artifacts; delete any older than `maxAgeDays`.
4. Worst-case disk ≈ `maxFileSize * (maxFiles + 1)` (plus the active file), independent
   of process lifetime.

### Modules inside the single file
- `LEVELS` table + level helpers
- `serializeError(e)` with cyclic-safe `cause` walk
- `safeStringify(record)` (handles BigInt, circular refs, functions)
- `captureSource()` stack parser
- `FileSink` — open/append/rotate/gzip/prune, exit hooks
- `prettyFormat(record)` — TTY console line with ANSI colors
- `Logger` class — levels, `child`, base/ctx merge
- `createLogger(options)` factory + default export

## Steps
1. Write this plan (done).
2. Implement `slog.ts`: types, level table, error/JSON serialization, source capture.
3. Implement `FileSink`: sync append + byte counting, rotation, gzip, pruning, exit flush.
4. Implement console pretty formatter (TTY-aware, ANSI, no color when piped).
5. Implement `Logger` + `child` + `createLogger` factory; wire sinks.
6. Add `examples/demo.ts` exercising levels, child, errors, and forced rotation.
7. Verify: run demo with `node slog.ts`-strip-types, assert NDJSON validity, confirm
   rotation/gzip/prune produce bounded file set.
8. Append `## Outcome` with results and any deviations.

## Risks & Open Questions
- **Runtime assumption**: Node-only (uses `node:fs`/`zlib`/`os`). Documented; console-only
  paths still work elsewhere. Default chosen rather than asking, since `plan.md` implies a
  server-side personal app writing to disk.
- **Sync writes under high throughput** are slower than buffered. Default to sync for
  crash-safety (a lost tail is worse for AI debugging); `sync:false` opt-out provided.
- **Rotation race**: single-process assumption (matches "single-machine personal") avoids
  multi-writer coordination.
- **Source capture cost**: off by default; stack parsing is best-effort across runtimes.

## Estimated Complexity
Medium — single file, no deps, but rotation/gzip/prune + crash-safe exit handling and a
stable serialization contract require care.

## Outcome
Implemented as planned.

Delivered:
- `slog.ts` — the vendorable single file (zero deps, `node:*` only). Exports
  `createLogger` (default + named), `Logger`, and types `Level`, `LogRecord`,
  `SlogOptions`, `SerializedError`.
- `examples/demo.ts` — smoke test exercising levels, `child`, `Error`+`cause`
  serialization, source capture, and forced rotation.

Verified on Node v24.15.0 (native TS type-stripping, `node examples/demo.ts`):
- File output is valid NDJSON (every line parses).
- Size rotation fires; rotated files are gzipped to `.log.gz`.
- Retention pruning holds the set to `maxFiles` rotated + 1 active, so worst-case
  disk is bounded (`≈ maxFileSize * (maxFiles + 1)`) regardless of uptime.
- `src` resolves to a clean project-relative `file:line` (e.g. `examples/demo.ts:34`).
- Errors serialize with `name`/`message`/`stack` and a recursive `cause` chain.

Schema header (AI self-orientation):
- The first line of every file (active **and** each rotated/gzipped file) is a
  self-describing record `{ "_meta": "slog", "v", "format", "levels", "fields", ... }`
  documenting each field's meaning. A log-reading agent learns the format from the file
  itself; parsers skip any line carrying `_meta`. Toggle via `schemaHeader` (default true).

Node 24+ adjustment:
- Console color now uses `util.styleText` instead of hand-rolled ANSI escapes. It
  auto-detects the stream's color support and honors `NO_COLOR` / `FORCE_COLOR`.
  Verified: `FORCE_COLOR=1` emits ANSI, `NO_COLOR=1` emits plain text.

Deviations / notes:
- Method signatures are `level(msg, fields?)`; an `Error` placed at `fields.err`
  (or any Error-valued field) is auto-serialized — slightly more explicit than an
  overloaded `error(err)` form, but predictable.
- Error/fatal records also mirror to `stderr` (others to `stdout`).
- Editor shows `Cannot find name 'process'/'Buffer'/'node:fs'` because this bare repo
  has no `@types/node`; these vanish in any consuming project. Not a runtime issue.
- Not yet done: redaction hook and async-mode durability tests — left as future work
  per the out-of-scope list.

## Usage
```ts
import { createLogger } from "./vendor/slog.ts";

const log = createLogger({ dir: "./logs", level: "info", base: { app: "myapp" } });
log.info("started", { port: 8080 });

const reqLog = log.child({ requestId });
try { /* ... */ } catch (err) { reqLog.error("failed", { err }); }
```

