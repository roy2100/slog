/**
 * Demo / smoke test for slog.
 * Run: node examples/demo.ts   (Node 22.6+ strips TS types natively)
 *  or: npx tsx examples/demo.ts
 */
import { createLogger } from "../slog.ts";

const log = createLogger({
  level: "debug",
  dir: "./logs",
  filename: "demo",
  captureSource: true,
  // Tiny size so the demo actually triggers rotation + gzip + pruning.
  maxFileSize: 8 * 1024,
  maxFiles: 3,
  base: { app: "demo", v: 1 },
});

log.info("server started", { port: 8080, env: "dev" });
log.debug("config loaded", { keys: ["a", "b", "c"] });

const reqLog = log.child({ requestId: "req-123" });
reqLog.info("handling request", { method: "GET", path: "/users" });
reqLog.warn("slow query", { ms: 412 });

try {
  throw new TypeError("boom", { cause: new Error("root cause") });
} catch (err) {
  reqLog.error("request failed", { err, status: 500 });
}

// Generate enough volume to force several rotations.
for (let i = 0; i < 400; i++) {
  log.info("tick", { i, payload: "x".repeat(64) });
}

log.fatal("shutting down", { reason: "demo complete" });
log.close();

console.log("\n--- demo done; inspect ./logs/demo*.log* ---");
