# slog

A structured logger that ships as **one vendorable TypeScript file**. Copy `slog.ts`
into your project, import it, and you have NDJSON logs that are easy for an AI agent to
read and that never run away with your disk.

- **Single file.** No build step, no `src/` tree — just `slog.ts`.
- **Zero runtime dependencies.** Node.js built-ins only.
- **Crash-safe.** Logging never throws into your app; all file I/O is swallowed on error.
- **Bounded disk.** Size rotation + gzip + retention pruning cap worst-case usage.
- **AI-friendly.** Machine-parseable NDJSON with a self-describing schema header.

> Requires **Node.js >= 24** (native TypeScript execution, `util.styleText` for color).

## Why slog

Built for single-machine, personal apps — not a distributed log pipeline. The output is
optimized so an AI agent can `grep`/stream/parse it line by line to diagnose problems,
and so a long-running process can't fill the disk. If you need network transport, log
shipping, multi-process aggregation, PII scrubbing, or sampling, this is the wrong tool
(those are out of scope by design).

## Install

slog is meant to be **vendored**, not installed as a dependency. Copy the single file in:

```bash
mkdir -p vendor
curl -o vendor/slog.ts https://raw.githubusercontent.com/roy2100/slog/main/slog.ts
# or just cp slog.ts into your repo
```

Then import it (note the `.ts` extension, required by Node's native TS loader):

```ts
import { createLogger } from "./vendor/slog.ts";
```

## Quickstart

```ts
import { createLogger } from "./vendor/slog.ts";

const log = createLogger({ dir: "./logs", level: "info", base: { app: "myapp" } });

log.info("server started", { port: 8080 });   // message first, then a fields object
log.warn("slow query", { ms: 412 });

// Errors: put the Error in the `err` field — it's auto-serialized (stack + cause chain).
try {
  risky();
} catch (err) {
  log.error("request failed", { err, status: 500 });
}

// Child logger: binds context onto every record it (and its children) emit.
const reqLog = log.child({ requestId });
reqLog.debug("handling", { method: "GET" });   // ctx = app + requestId + method

log.close();   // optional: flush + close the file before a clean shutdown
```

## API

```ts
createLogger(options?: SlogOptions): Logger   // default export is createLogger too

log.trace(msg, fields?)
log.debug(msg, fields?)
log.info(msg, fields?)
log.warn(msg, fields?)
log.error(msg, fields?)
log.fatal(msg, fields?)

log.child(bindings): Logger   // new logger that merges `bindings` into every record
log.close(): void             // flush + close the file sink
```

Levels, low to high: `trace(10) < debug(20) < info(30) < warn(40) < error(50) < fatal(60)`.
Records at `error` and above go to `stderr`; everything else to `stdout`.

### Options

All options are optional with sensible defaults.

| Option          | Default     | Description                                                        |
| --------------- | ----------- | ------------------------------------------------------------------ |
| `level`         | `"info"`    | Minimum level to emit.                                             |
| `dir`           | `"./logs"`  | Directory for log files.                                           |
| `filename`      | `"app"`     | Base filename (without extension) → `app.log`.                     |
| `file`          | `true`      | Write to a file. Set `false` to disable file output.              |
| `console`       | `"auto"`    | Write to console. `"auto"` = only when stdout is a TTY.            |
| `pretty`        | `"auto"`    | Colorized console output. `"auto"` = pretty when stdout is a TTY.  |
| `maxFileSize`   | `10 MiB`    | Rotate when the active file would exceed this many bytes.          |
| `maxFiles`      | `5`         | Number of rotated files to keep.                                   |
| `maxAgeDays`    | `14`        | Delete rotated files older than this many days.                   |
| `gzip`          | `true`      | Gzip rotated files.                                                |
| `captureSource` | `false`     | Capture `{ file, line }` from the call stack (has a perf cost).    |
| `base`          | `{}`        | Fields merged into every record.                                  |
| `sync`          | `true`      | Synchronous appends (crash-safe).                                 |
| `schemaHeader`  | `true`      | Write a self-describing schema header as the first line of a file. |

Color honors `NO_COLOR` / `FORCE_COLOR` and auto-detects TTY support via `util.styleText`.

## Output format

NDJSON — one self-contained JSON object per line. The **first line of every file** is a
schema header keyed by `_meta`, so a log-reading agent self-orients from the file itself:

```json
{"_meta":"slog","v":"0.1","format":"ndjson","levels":{...},"fields":{...}, ...}
```

Skip any line that has `_meta`; every other line is a record:

```json
{"ts":"2026-06-12T10:31:04.512Z","t":1749724264512,"level":"info","lvl":30,"msg":"server started","pid":4821,"host":"mac","ctx":{"app":"myapp","port":8080}}
```

| Field   | Meaning                                                                 |
| ------- | ---------------------------------------------------------------------- |
| `ts`    | ISO-8601 timestamp with milliseconds (human + machine).                |
| `t`     | Epoch milliseconds (sortable).                                          |
| `level` | Level name: `trace` … `fatal`.                                         |
| `lvl`   | Numeric severity (10–60), for range filters.                          |
| `msg`   | Short human-readable message.                                          |
| `pid`   | Process id.                                                            |
| `host`  | Hostname.                                                              |
| `ctx`   | Merged base + child + per-call structured fields (optional).          |
| `err`   | Serialized error: `{ name, message, stack, code?, cause? }` (optional).|
| `src`   | Call site `{ file, line, fn? }` when `captureSource` is on (optional). |

`safeStringify` tolerates BigInt, functions, and circular references so a bad field can
never crash a log call.

### Reading the logs

```bash
# Pretty-print live records (skip the schema header), with jq:
tail -f logs/app.log | grep -v '"_meta"' | jq .

# Only warnings and above:
jq 'select(._meta == null and .lvl >= 40)' logs/app.log

# Read a rotated, gzipped file:
gunzip -c logs/app-20260612-103104-512.log.gz | jq .
```

## Disk bounds

Worst-case disk usage is held to roughly `maxFileSize * (maxFiles + 1)` regardless of
uptime: the active file rotates at `maxFileSize`, rotated files are gzipped, and pruning
keeps only the newest `maxFiles` artifacts while also dropping anything older than
`maxAgeDays`.

## Development

```bash
npm run typecheck   # tsc --noEmit, strict mode — must exit 0
npm run demo        # smoke test → writes valid NDJSON under ./logs/
npm test            # node --test
npm run coverage    # node --test --experimental-test-coverage
```

`logs/` and `node_modules/` are gitignored. See `docs/plan-slog.md` for design rationale
and `examples/demo.ts` for a runnable example.

## License

MIT
