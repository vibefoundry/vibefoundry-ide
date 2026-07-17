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
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = process.argv[2] || join(HERE, "vibefoundry/server/index.js");
const TEMP = await mkdtemp(join(tmpdir(), "vibefoundry-mcp-selftest-"));
const PROJECT = join(TEMP, "project-one");
const PROJECT_TWO = join(TEMP, "project-two");
const MOCK = join(TEMP, "mock-backend.mjs");
await mkdir(PROJECT);
await mkdir(PROJECT_TWO);
await writeFile(MOCK, `#!/usr/bin/env node
import http from "node:http";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const project = args[args.length - 1];
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/health") {
    res.end(JSON.stringify({
      status: "ok",
      project_folder: project,
      version: "selftest",
      pid: process.pid,
    }));
    return;
  }
  if (req.url === "/api/catalog") {
    res.end(JSON.stringify({ datasets: [] }));
    return;
  }
  if (req.url === "/api/files/tree") {
    res.end(JSON.stringify({ tree: { children: [] } }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ detail: "Not Found" }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
await chmod(MOCK, 0o755);

const child = spawn("node", [MCP], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    VF_BACKEND_CMD: `"${process.execPath}" "${MOCK}" --port {port} --no-browser`,
  },
});
let buf = "";
let stderr = "";
let rootRequests = 0;
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
      if (m.method === "roots/list") {
        rootRequests++;
        const activeProject = rootRequests === 1 ? PROJECT : PROJECT_TWO;
        child.stdin.write(JSON.stringify({
          jsonrpc: "2.0",
          id: m.id,
          result: { roots: [{ uri: pathToFileURL(activeProject).href, name: "active-project" }] },
        }) + "\n");
        continue;
      }
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
const openTool = ok(tools) && tools.result.tools.find((t) => t.name === "open_vibefoundry");
check("open tool requires Codex's current task root",
  openTool && openTool.inputSchema.required?.includes("projectRoot"));

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

const firstOpen = await call("tools/call", { name: "open_vibefoundry", arguments: {} });
check("first open uses the active project root",
  ok(firstOpen) && firstOpen.result.structuredContent.projectFolder === PROJECT,
  ok(firstOpen) ? JSON.stringify(firstOpen.result.structuredContent) : why(firstOpen));
const firstHealth = await call("tools/call", {
  name: "vf_request",
  arguments: { path: "/api/health" },
});
const firstPid = ok(firstHealth) && firstHealth.result.structuredContent.json?.pid;
const firstPort = ok(firstOpen) &&
  Number(new URL(firstOpen.result.structuredContent.backendUrl).port);

const secondOpen = await call("tools/call", { name: "open_vibefoundry", arguments: {} });
check("second open uses the active project root",
  ok(secondOpen) && secondOpen.result.structuredContent.projectFolder === PROJECT_TWO,
  ok(secondOpen) ? JSON.stringify(secondOpen.result.structuredContent) : why(secondOpen));
const secondHealth = await call("tools/call", {
  name: "vf_request",
  arguments: { path: "/api/health" },
});
const secondPid = ok(secondHealth) && secondHealth.result.structuredContent.json?.pid;
const secondPort = ok(secondOpen) &&
  Number(new URL(secondOpen.result.structuredContent.backendUrl).port);
check("each open starts a fresh backend process",
  Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
  `${firstPid || "?"} -> ${secondPid || "?"}`);
check("the conversation keeps one OS-assigned backend port",
  Number.isInteger(firstPort) && firstPort > 0 && firstPort === secondPort,
  `${firstPort || "?"} -> ${secondPort || "?"}`);
check("each open re-reads Codex's active project root", rootRequests === 2, String(rootRequests));

const explicitOpen = await call("tools/call", {
  name: "open_vibefoundry",
  arguments: { projectRoot: PROJECT },
});
check("explicit task root bypasses host root discovery",
  ok(explicitOpen) &&
    explicitOpen.result.structuredContent.projectFolder === PROJECT &&
    rootRequests === 2,
  ok(explicitOpen) ? JSON.stringify(explicitOpen.result.structuredContent) : why(explicitOpen));

if (stderr.trim()) console.log("\nstderr:\n" + stderr.slice(0, 500));
child.kill();
await rm(TEMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
