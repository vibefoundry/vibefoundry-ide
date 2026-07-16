#!/usr/bin/env node
/**
 * Smoke test for the pane MCP — run before publishing.
 *
 * Exists because `node --check` passes on undefined-variable bugs: making the
 * backend port dynamic removed `const BACKEND_WS` but left a reference to it in
 * resources/read, and 0.2.32 shipped with a pane that could not load at all
 * ("BACKEND_WS is not defined"). Syntax checks and testing ensureBackend in
 * isolation both missed it. Only actually driving every method finds this class
 * of bug.
 *
 *   node codex-plugin/selftest.mjs [path/to/index.js]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = process.argv[2] || join(HERE, "vibefoundry/server/index.js");

const child = spawn("node", [MCP], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
let stderr = "";
const pending = {};
child.stderr.on("data", (d) => (stderr += d));
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch { /* not our line */ }
  }
});

let id = 0;
const call = (method, params) =>
  new Promise((res) => {
    const n = ++id;
    pending[n] = res;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    setTimeout(() => { if (pending[n]) { pending[n]({ timeout: true }); delete pending[n]; } }, 20000);
  });

let failed = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

const ok = (m) => !m.timeout && !m.error && m.result;
const why = (m) => (m.timeout ? "TIMEOUT" : m.error ? `${m.error.code}: ${m.error.message}` : "no result");

const init = await call("initialize", {
  protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "1" },
});
check("initialize", ok(init), ok(init) ? "" : why(init));

check("ping", ok(await call("ping", {})));

const tools = await call("tools/list", {});
const names = ok(tools) ? tools.result.tools.map((t) => t.name) : [];
check("tools/list exposes all three", ["open_vibefoundry", "vf_request", "vf_catalog"].every((n) => names.includes(n)),
  names.join(", ") || why(tools));

const rlist = await call("resources/list", {});
check("resources/list", ok(rlist) && rlist.result.resources.length > 0, ok(rlist) ? "" : why(rlist));

// The one that matters: this is what the host calls to render the pane.
const rr = await call("resources/read", { uri: "ui://widget/vibefoundry.html" });
check("resources/read serves the pane", ok(rr), ok(rr) ? "" : why(rr));
if (ok(rr)) {
  const c = rr.result.contents[0];
  check("  pane HTML is non-trivial", (c.text || "").length > 1000, `${(c.text || "").length} bytes`);
  const domains = c._meta?.ui?.csp?.connectDomains || [];
  check("  csp names http + ws backend", domains.length === 2 && domains.some((d) => d.startsWith("ws")),
    JSON.stringify(domains));
}

if (stderr.trim()) console.log("\nstderr:\n" + stderr.slice(0, 500));
child.kill();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
