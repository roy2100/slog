/**
 * Unit tests for slog. Single file, zero deps — uses Node's built-in test runner.
 * Run: node --test slog.test.ts   (Node >= 24)
 *  or: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { createLogger, type LogRecord } from "./slog.ts";

// --- helpers ---------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "slog-test-"));
}

/** Parse every line of a file into objects. */
function readJsonLines(file: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Records only — skips the `_meta` schema header line(s). */
function readRecords(file: string): LogRecord[] {
  return readJsonLines(file).filter((o) => !("_meta" in o)) as unknown as LogRecord[];
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Run `fn` while capturing everything written to stdout/stderr. */
function captureStdio(fn: () => void): { out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = ((c: string | Uint8Array) => {
    out.push(String(c));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => {
    err.push(String(c));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { out: out.join(""), err: err.join("") };
}

/** Poll until `cond` is true or the timeout elapses (for async flushing). */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// --- tests -----------------------------------------------------------------

test("writes NDJSON records with the expected shape", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false });
  log.info("hello", { a: 1, b: "x" });
  log.close();

  const recs = readRecords(path.join(dir, "t.log"));
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.level, "info");
  assert.equal(r.lvl, 30);
  assert.equal(r.msg, "hello");
  assert.deepEqual(r.ctx, { a: 1, b: "x" });
  assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(typeof r.t, "number");
  assert.equal(typeof r.pid, "number");
  assert.equal(typeof r.host, "string");
});

test("first line is the self-describing schema header; records have no _meta", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false });
  log.info("rec");
  log.close();

  const lines = readJsonLines(path.join(dir, "t.log"));
  assert.equal(lines[0]._meta, "slog");
  assert.equal((lines[0].fields as Record<string, unknown>).msg !== undefined, true);
  assert.equal("_meta" in lines[1], false);
});

test("schemaHeader:false suppresses the header line", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, schemaHeader: false });
  log.info("rec");
  log.close();

  const lines = readJsonLines(path.join(dir, "t.log"));
  assert.equal(lines.length, 1);
  assert.equal("_meta" in lines[0], false);
});

test("respects the minimum level", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, level: "warn" });
  log.debug("no");
  log.info("no");
  log.warn("yes");
  log.error("yes");
  log.close();

  const recs = readRecords(path.join(dir, "t.log"));
  assert.deepEqual(recs.map((r) => r.level), ["warn", "error"]);
});

test("child() merges base + child + nested + per-call context", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, base: { app: "t" } });
  const child = log.child({ requestId: "r1" });
  const grandchild = child.child({ span: "s9" });
  grandchild.info("nested", { ok: true });
  log.close();

  const r = readRecords(path.join(dir, "t.log"))[0];
  assert.deepEqual(r.ctx, { app: "t", requestId: "r1", span: "s9", ok: true });
});

test("serializes Error in the `err` field with stack and cause chain", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false });
  const err = new TypeError("boom", { cause: new Error("root") });
  log.error("failed", { err, status: 500 });
  log.close();

  const r = readRecords(path.join(dir, "t.log"))[0];
  assert.equal(r.err?.name, "TypeError");
  assert.equal(r.err?.message, "boom");
  assert.match(r.err?.stack ?? "", /TypeError: boom/);
  assert.equal((r.err?.cause as { message?: string })?.message, "root");
  assert.deepEqual(r.ctx, { status: 500 });
});

test("captureSource adds a project-relative src", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, captureSource: true });
  log.info("with-src");
  log.close();

  const r = readRecords(path.join(dir, "t.log"))[0];
  assert.ok(r.src, "src should be present");
  assert.match(r.src!.file, /slog\.test\.ts$/);
  assert.equal(typeof r.src!.line, "number");
});

test("safeStringify tolerates BigInt and circular references", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false });
  const cyclic: Record<string, unknown> = { n: 7n };
  cyclic.self = cyclic;
  log.info("weird", { cyclic });
  log.close();

  const r = readRecords(path.join(dir, "t.log"))[0];
  const ctx = r.ctx as { cyclic: { n: string; self: string } };
  assert.equal(ctx.cyclic.n, "7n");
  assert.equal(ctx.cyclic.self, "[Circular]");
});

test("rotates by size, gzips rotated files, and prunes to maxFiles", () => {
  const dir = tmpDir();
  const log = createLogger({
    dir,
    filename: "t",
    console: false,
    schemaHeader: false,
    gzip: true,
    maxFileSize: 512,
    maxFiles: 2,
  });
  for (let i = 0; i < 200; i++) log.info("tick", { i, pad: "x".repeat(40) });
  log.close();

  const files = fs.readdirSync(dir);
  const rotated = files.filter((f) => f.startsWith("t-"));
  assert.ok(rotated.length > 0, "expected at least one rotated file");
  assert.ok(rotated.length <= 2, `pruning should bound rotated files, got ${rotated.length}`);
  assert.ok(rotated.every((f) => f.endsWith(".log.gz")), "rotated files should be gzipped");
  assert.ok(files.includes("t.log"), "active file should exist");

  // A gzipped rotated file must decompress to valid NDJSON.
  const gz = path.join(dir, rotated[0]);
  const text = zlib.gunzipSync(fs.readFileSync(gz)).toString("utf8").trim();
  for (const line of text.split("\n")) JSON.parse(line);
});

test("file:false disables file output but does not throw", () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, file: false });
  log.info("nowhere");
  log.close();
  assert.equal(fs.existsSync(path.join(dir, "t.log")), false);
});

test("appends to an existing file without re-injecting a header", () => {
  const dir = tmpDir();
  const a = createLogger({ dir, filename: "t", console: false });
  a.info("first");
  a.close();
  const b = createLogger({ dir, filename: "t", console: false });
  b.info("second");
  b.close();

  const lines = readJsonLines(path.join(dir, "t.log"));
  const headers = lines.filter((o) => "_meta" in o);
  assert.equal(headers.length, 1, "only one schema header for the file's lifetime");
  assert.equal(readRecords(path.join(dir, "t.log")).length, 2);
});

test("pretty console renders a human line; errors go to stderr", () => {
  const log = createLogger({ file: false, console: true, pretty: true });
  const { out, err } = captureStdio(() => {
    log.info("hello", { a: 1 });
    log.error("boom", { err: new Error("kaboom") });
  });
  log.close();

  const cleanOut = stripAnsi(out);
  assert.match(cleanOut, /INFO/);
  assert.match(cleanOut, /hello/);
  assert.match(cleanOut, /a=1/);
  // error/fatal route to stderr, not stdout
  assert.doesNotMatch(cleanOut, /boom/);
  const cleanErr = stripAnsi(err);
  assert.match(cleanErr, /ERROR/);
  assert.match(cleanErr, /boom/);
  assert.match(cleanErr, /Error: kaboom/);
});

test("non-pretty console emits valid JSON to stdout", () => {
  const log = createLogger({ file: false, console: true, pretty: false });
  const { out } = captureStdio(() => log.info("structured", { k: "v" }));
  log.close();

  const rec = JSON.parse(stripAnsi(out).trim());
  assert.equal(rec.msg, "structured");
  assert.deepEqual(rec.ctx, { k: "v" });
});

test("async (sync:false) mode writes to the file after flush", async () => {
  const dir = tmpDir();
  const log = createLogger({ dir, filename: "t", console: false, sync: false });
  log.info("async-record", { x: 1 });
  log.close();

  const file = path.join(dir, "t.log");
  await waitFor(
    () => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("async-record"),
  );
  const recs = readRecords(file);
  assert.equal(recs.at(-1)?.msg, "async-record");
  assert.deepEqual(recs.at(-1)?.ctx, { x: 1 });
});
