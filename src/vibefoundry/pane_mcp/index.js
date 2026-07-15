#!/usr/bin/env node
/*
 * VibeFoundry — minimal Apps SDK MCP server (zero dependencies).
 *
 * Speaks the MCP stdio protocol (newline-delimited JSON-RPC 2.0) by hand so it
 * runs with nothing but Node — no `npm install`. It exposes ONE tool,
 * `open_vibefoundry`, linked to ONE HTML widget resource that ChatGPT renders
 * inline and can expand to a fullscreen pane.
 *
 * This is a proof-of-plumbing, not the real IDE: the widget is a static shell.
 * Once the pane renders, the next step is to add real tools (run_script,
 * preview_data, ...) and grow the widget into the ported VibeFoundry UI.
 */

"use strict";

// --- Apps SDK wiring constants -------------------------------------------------
// If the pane does NOT render in your desktop-app version, these two values are
// the most likely thing to swap (see INSTALL.md "If the pane doesn't render"):
//   WIDGET_MIME:  "text/html+skybridge"  <->  "text/html;profile=mcp-app"
//   The tool _meta key linking to the template is set in TOOL_META below.
const WIDGET_URI = "ui://widget/vibefoundry.html";
const WIDGET_MIME = "text/html+skybridge";

// Where the real VibeFoundry FastAPI backend runs.
//
// NOT a fixed port. It used to be pinned to 8765, which meant: if anything else
// already held 8765 (a `vibefoundry` in a terminal, a leftover from a previous
// session), we passed --port 8765 anyway — and an explicit --port skips the
// CLI's find_available_port(), so there was no fallback. The spawn could never
// bind, while the health check happily passed against the *other* process. The
// pane then silently drove someone else's backend, rooted at whatever project
// THAT was opened with (a `vibefoundry` launched from ~ roots at the whole home
// directory, which is why the pane crawled).
//
// Now: adopt an existing backend only if it's serving the project we want, else
// pick a genuinely free port and remember it. VF_BACKEND still pins it if set.
const BACKEND_FIXED = process.env.VF_BACKEND || null;
let BACKEND = BACKEND_FIXED || "http://127.0.0.1:8765";

// Ports we're willing to run on. Matches the CLI's own search from 8765 up.
const PORT_MIN = 8765;
const PORT_MAX = 8799;

// Link the tool to its widget template. We set BOTH known conventions so that
// whichever one this desktop-app build honors will match; extra keys are
// harmless if ignored.
const TOOL_META = {
  "openai/outputTemplate": WIDGET_URI,
  ui: { resourceUri: WIDGET_URI },
};

const SERVER_INFO = { name: "vibefoundry", version: "0.0.1" };

// --- Backend supervision -------------------------------------------------------
// The MCP server auto-starts the VibeFoundry FastAPI backend so the user never
// has to. Command is configurable via VF_BACKEND_CMD; the default assumes the
// `vibefoundry` console script is installed (pip). We run it through a LOGIN
// shell so it inherits the user's full PATH — GUI-launched processes on macOS
// otherwise get a minimal PATH that won't find pip/homebrew binaries.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// The real VibeFoundry UI, built as one self-contained HTML by
// `vite build --config vite.pane.config.js`. If present, we serve it as the
// widget; otherwise we fall back to the placeholder shell (WIDGET_HTML).
const PANE_HTML_PATH = path.join(__dirname, "pane", "index.pane.html");
function loadPaneHtml() {
  try {
    return fs.readFileSync(PANE_HTML_PATH, "utf8");
  } catch (e) {
    return null;
  }
}

function backendPort() {
  return (BACKEND.match(/:(\d+)/) || [])[1] || "8765";
}
function backendCmd() {
  return (
    process.env.VF_BACKEND_CMD ||
    "vibefoundry --port " + backendPort() + " --no-browser"
  );
}

// --- Port discovery ------------------------------------------------------------
const net = require("net");

// Free means "we can actually bind it", not "nothing answered a health check" —
// a port can be held by something that isn't ours and doesn't speak HTTP.
function isPortFree(port) {
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.once("error", function () { resolve(false); });
    srv.once("listening", function () { srv.close(function () { resolve(true); }); });
    srv.listen(port, "127.0.0.1");
  });
}

async function findFreePort() {
  for (var p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

function healthAt(port, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 700);
  return fetch("http://127.0.0.1:" + port + "/api/health", { signal: ctrl.signal })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (j) { clearTimeout(t); return j; });
}

// Compare real paths, not strings. The backend reports its folder resolved, so
// on macOS "/tmp/x" comes back as "/private/tmp/x" — a string compare would call
// the same project a different one and spawn a redundant backend every launch.
function samePath(a, b) {
  if (!a || !b) return false;
  var real = function (s) {
    try { return fs.realpathSync(String(s)).replace(/\/+$/, ""); }
    catch (e) { return String(s).replace(/\/+$/, ""); }  // may not exist yet
  };
  return real(a) === real(b);
}

// Find a RUNNING backend we're willing to use. "Willing" is the point: adopting
// anything that answers is how the pane ended up driving a home-directory-rooted
// server. If a project was requested, the backend must actually be serving it.
async function findUsableBackend(project) {
  for (var p = PORT_MIN; p <= PORT_MAX; p++) {
    var h = await healthAt(p, 400);
    if (!h || h.status !== "ok") continue;
    if (!project) return p;                       // no preference — any will do
    if (samePath(h.project_folder, project)) return p;
  }
  return null;
}

let backendChild = null;

function backendAlive() {
  return !!backendChild && backendChild.exitCode === null && !backendChild.signalCode;
}

// Tear down the backend we spawned. Without this the child reparents to init and
// squats BACKEND_PORT forever — every later launch then drifts to another port.
// We signal the process GROUP (negative pid): the shell fallback runs python as a
// grandchild, so signalling the shell alone would leave python behind.
function killBackend() {
  if (!backendAlive()) { backendChild = null; return; }
  var pid = backendChild.pid;
  backendChild = null;
  try {
    // win32 has no process groups; the preferred path there spawns python
    // directly, so a plain kill covers it.
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch (e) {}
}

["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach(function (sig) {
  process.on(sig, function () {
    killBackend();
    if (sig !== "exit") process.exit(0);
  });
});

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function healthCheck(timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
  return fetch(BACKEND + "/api/health", { signal: ctrl.signal })
    .then(function (r) { return r.ok; })
    .catch(function () { return false; })
    .then(function (ok) { clearTimeout(t); return ok; });
}

// Ensure the backend is up. Reuses an already-running instance (started
// manually or by a prior call) via the health check before spawning a new one.
// Resolve the Python interpreter that OWNS this package so we can run
// `python -m vibefoundry` directly — no PATH guessing, works on any OS.
// pane_mcp/index.js lives at <env>/.../site-packages/vibefoundry/pane_mcp/.
function resolveBundledPython() {
  var candidates =
    process.platform === "win32"
      ? [path.join(__dirname, "..", "..", "..", "..", "python.exe")] // <env>\Lib\site-packages\vibefoundry\pane_mcp -> <env>\python.exe
      : [
          path.join(__dirname, "..", "..", "..", "..", "..", "bin", "python3"),
          path.join(__dirname, "..", "..", "..", "..", "..", "bin", "python"),
        ]; // <env>/lib/pythonX/site-packages/vibefoundry/pane_mcp -> <env>/bin/python
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.existsSync(candidates[i])) return candidates[i]; } catch (e) {}
  }
  return null;
}

async function ensureBackend(project) {
  // 1. Our own child, still up and serving what we asked for? Reuse it.
  if (backendAlive() && (await healthCheck(800))) {
    return { started: false, ok: true, port: backendPort() };
  }

  // 2. Someone else's backend — adopt ONLY if it's serving this project. A
  //    `vibefoundry` running in a terminal (rooted at ~, indexing the whole home
  //    directory) must not get silently adopted just because it answers.
  if (BACKEND_FIXED) {
    if (await healthCheck(800)) return { started: false, ok: true, port: backendPort() };
  } else {
    var existing = await findUsableBackend(project);
    if (existing !== null) {
      BACKEND = "http://127.0.0.1:" + existing;
      return { started: false, ok: true, port: String(existing), adopted: true };
    }
  }

  // 3. Nothing usable — start our own on a port that's genuinely free. Pinning
  //    8765 meant colliding with whatever already held it and never binding.
  if (!backendAlive()) {
    var port = BACKEND_FIXED ? backendPort() : await findFreePort();
    if (!port) {
      return { started: false, ok: false, error: "no free port in " + PORT_MIN + "-" + PORT_MAX };
    }
    if (!BACKEND_FIXED) BACKEND = "http://127.0.0.1:" + port;
    try {
      // detached: own process group, so killBackend can signal the whole tree.
      var opts = {
        stdio: "ignore",
        env: process.env,
        windowsHide: true,
        detached: process.platform !== "win32",
      };
      var py = resolveBundledPython();
      if (py) {
        // Preferred: run the exact interpreter that has vibefoundry installed.
        var args = ["-m", "vibefoundry", "--port", String(port), "--no-browser"];
        if (project) args.push(project);
        backendChild = spawn(py, args, opts);
      } else {
        // Fallback: run VF_BACKEND_CMD through the platform's shell (NOT /bin/zsh on Windows).
        var cmd = backendCmd();
        if (project) cmd += ' "' + String(project).replace(/"/g, '\\"') + '"';
        if (process.platform === "win32") {
          backendChild = spawn(process.env.ComSpec || "cmd.exe", ["/c", cmd], opts);
        } else {
          var shell = process.env.SHELL || "/bin/sh";
          backendChild = spawn(shell, ["-lc", cmd], opts);
        }
      }
      backendChild.on("error", function () {});
      // Don't keep the MCP server's event loop alive on the backend's account.
      backendChild.unref();
    } catch (e) {
      return { started: false, ok: false, error: String(e && e.message) };
    }
  }

  // Poll for readiness (~20s).
  for (var i = 0; i < 40; i++) {
    await sleep(500);
    if (await healthCheck(800)) return { started: true, ok: true, port: backendPort() };
  }
  return { started: true, ok: false, port: backendPort() };
}

// --- The widget (self-contained, no external assets → no CSP surprises) --------
const WIDGET_HTML = `<!doctype html>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0d1117; background: #f6f8fa;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6edf3; background: #0d1117; }
    .card { background: #161b22 !important; border-color: #30363d !important; }
    .muted { color: #8b949e !important; }
  }
  .wrap { padding: 24px; max-width: 960px; margin: 0 auto; }
  .head { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 40px; height: 40px; border-radius: 10px; flex: none;
    background: linear-gradient(135deg, #ff7a18, #af002d);
    display: grid; place-items: center; color: #fff; font-weight: 800;
  }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #57606a; margin: 2px 0 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }
  .card { background: #fff; border: 1px solid #d0d7de; border-radius: 12px; padding: 16px; }
  .card h3 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  .card p { margin: 0; font-size: 22px; font-weight: 700; }
  .row { margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button {
    font: inherit; font-weight: 600; cursor: pointer;
    border: 1px solid #d0d7de; border-radius: 8px; padding: 8px 14px;
    background: #ff7a18; color: #fff; border-color: transparent;
  }
  button.secondary { background: transparent; color: inherit; border-color: #d0d7de; }
  code { background: rgba(127,127,127,.15); padding: 1px 6px; border-radius: 5px; }
</style>
<div class="wrap">
  <div class="head">
    <div class="logo">VF</div>
    <div>
      <h1>VibeFoundry</h1>
      <p class="muted" id="status">Data-science pane — running inside ChatGPT.</p>
    </div>
  </div>

  <div class="grid">
    <div class="card"><h3>Mode</h3><p id="mode">inline</p></div>
    <div class="card"><h3>Bridge</h3><p id="bridge">…</p></div>
    <div class="card"><h3>Backend</h3><p id="backend">probing…</p></div>
  </div>

  <p class="muted" id="backend-detail" style="margin-top:12px">
    Direct probe of <code>__BACKEND__</code> …
  </p>
  <p class="muted" id="proxy-detail" style="margin-top:4px">
    Proxy probe (via MCP server) …
  </p>

  <div class="row">
    <button id="fs">Expand to fullscreen pane</button>
    <button class="secondary" id="pip">Float (PiP)</button>
    <span class="muted">Then plug the real IDE UI into this shell.</span>
  </div>

  <p class="muted" style="margin-top:20px">
    This confirms the plugin → MCP server → widget → pane path works. Backend
    calls will route through <code>window.openai</code> tool calls next.
  </p>
</div>

<script>
  (function () {
    var api = (typeof window !== "undefined" && window.openai) || null;
    var byId = function (id) { return document.getElementById(id); };

    byId("bridge").textContent = api ? "connected" : "not found";

    // Reflect any structured data the tool returned.
    try {
      var out = api && (api.toolOutput || api.output);
      if (out && out.message) byId("status").textContent = out.message;
    } catch (e) {}

    function setMode(mode) {
      if (!api || !api.requestDisplayMode) {
        byId("status").textContent = "requestDisplayMode unavailable in this host.";
        return;
      }
      Promise.resolve(api.requestDisplayMode({ mode: mode }))
        .then(function (r) {
          var applied = (r && r.mode) || mode;
          byId("mode").textContent = applied;
        })
        .catch(function () { byId("mode").textContent = "denied"; });
    }

    byId("fs").addEventListener("click", function () { setMode("fullscreen"); });
    byId("pip").addEventListener("click", function () { setMode("pip"); });

    // *** The make-or-break probe: can this pane reach the local backend? ***
    var backendUrl = "__BACKEND__";
    var t0 = Date.now();
    fetch(backendUrl + "/api/health", { method: "GET", mode: "cors" })
      .then(function (r) {
        return r.text().then(function (body) {
          byId("backend").textContent = "reachable ✓";
          byId("backend-detail").innerHTML =
            "Backend <b>reachable</b> at <code>" + backendUrl + "</code> (HTTP " +
            r.status + ", " + (Date.now() - t0) + "ms). The real IDE can run here.";
        });
      })
      .catch(function (err) {
        byId("backend").textContent = "blocked ✕";
        byId("backend-detail").innerHTML =
          "Backend <b>NOT reachable</b> at <code>" + backendUrl + "</code> — " +
          String(err && err.message || err) +
          ". Either the backend isn't running, or the sandbox blocks localhost " +
          "(then we route through MCP tools instead).";
      });

    // *** The real data path: ask the MCP server to fetch from the backend. ***
    // The pane can't reach localhost, but the Node MCP server can. This is how
    // the real IDE will get ALL its data.
    if (api && typeof api.callTool === "function") {
      api.callTool("vf_request", { path: "/api/health" })
        .then(function (res) {
          // callTool's return shape varies by host; dig out structuredContent.
          var sc = (res && (res.structuredContent ||
                    (res.result && res.result.structuredContent))) || res;
          if (sc && sc.ok) {
            byId("backend").textContent = "via proxy ✓";
            byId("proxy-detail").innerHTML =
              "<b>Proxy works.</b> Backend returned HTTP " + sc.status + ": <code>" +
              JSON.stringify(sc.json || sc.text) + "</code>. The pane can reach the " +
              "backend through the MCP server — the real IDE can run here.";
          } else {
            byId("proxy-detail").innerHTML =
              "Proxy returned: <code>" + JSON.stringify(sc) + "</code>";
          }
        })
        .catch(function (err) {
          byId("proxy-detail").innerHTML =
            "Proxy call failed: <code>" + String(err && err.message || err) + "</code>";
        });
    } else {
      byId("proxy-detail").textContent =
        "window.openai.callTool unavailable in this host.";
    }

    // Auto-request a fullscreen pane on open. Hosts may ignore auto-requests
    // that aren't user-initiated — the button is the reliable fallback.
    setMode("fullscreen");
  })();
</script>`;

// --- Tool + resource definitions ----------------------------------------------
const TOOL = {
  name: "open_vibefoundry",
  description:
    "Open the VibeFoundry IDE as a pane inside ChatGPT. Call this tool " +
    "IMMEDIATELY and DIRECTLY (do not ask for confirmation, do not deliberate) " +
    "whenever the user asks to open, launch, start, show, or bring up any of: " +
    "VibeFoundry, the VibeFoundry IDE, the data-science IDE, their data " +
    "workspace, or their data pane. Example phrasings that MUST trigger it: " +
    "\"open VibeFoundry\", \"open vibefoundry\", \"launch VibeFoundry\", " +
    "\"open the IDE\", \"open my data workspace\", \"show VibeFoundry\", " +
    "\"start the data pane\". It auto-starts the local backend if needed and " +
    "renders the full VibeFoundry UI (file browser, data preview, scripts) as " +
    "a fullscreen pane. Pass the `project` argument when the user names a " +
    "specific project folder. Match generously through misspellings, " +
    "transpositions, spacing, and abbreviations — e.g. \"open vfoundry\", " +
    "\"open videfoundry\", \"open vibe foundry\", \"open vibefoundy\", " +
    "\"open VF\" all refer to VibeFoundry and MUST trigger this tool.",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Optional path to the project folder to open.",
      },
    },
    required: [],
  },
  _meta: TOOL_META,
};

// Generic proxy: the pane can't reach localhost (sandbox), but this Node process
// can. The widget calls this tool via window.openai.callTool("vf_request", ...)
// and we forward the request to the local FastAPI backend. One tool = the whole
// backend, unchanged.
const PROXY_TOOL = {
  name: "vf_request",
  description:
    "Internal: proxy an HTTP request to the local VibeFoundry backend. Used by " +
    "the pane UI to reach the backend past the iframe sandbox.",
  inputSchema: {
    type: "object",
    properties: {
      method: { type: "string", description: "HTTP method (default GET)." },
      path: { type: "string", description: "Backend path, e.g. /api/files/tree." },
      body: { description: "Optional JSON body for POST/PUT/etc." },
    },
    required: ["path"],
  },
};

// The catalogue, exposed to the model. This is the point of the whole feature:
// when the user asks "show me sales for the last 2 months", the model reads this
// to work out WHICH dataset holds sales, what one row means, which column is the
// date, and what the values look like — before pulling anything.
const CATALOG_TOOL = {
  name: "vf_catalog",
  description:
    "List the catalogued SharePoint datasets available to this project, with a " +
    "description of each one, what a row represents, its row count, and its " +
    "columns (with per-column descriptions, distinct values for categoricals and " +
    "min/max/mean for continuous). Call this FIRST when the user asks a question " +
    "about their data — it tells you which file to pull and which columns to use. " +
    "Optionally filter with `query` to match a name, description or column.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional filter, e.g. 'sales' or 'price'. Matches dataset names, " +
          "descriptions and column names. Omit to list everything.",
      },
      dataset: {
        type: "string",
        description:
          "Optional exact dataset name (e.g. 'sales.csv') to get its full column " +
          "profile instead of the summary listing.",
      },
    },
  },
};

function matchesQuery(ds, q) {
  if (!q) return true;
  q = q.toLowerCase();
  var hay = [ds.name, ds.title, ds.summary, ds.grain]
    .concat((ds.columns || []).map(function (c) { return c.name + " " + (c.description || ""); }))
    .join(" ")
    .toLowerCase();
  return hay.indexOf(q) !== -1;
}

async function catalogTool(args) {
  var r = await proxyRequest({ path: "/api/catalog", method: "GET" });
  if (!r.ok || !r.json) {
    return { error: "catalogue unavailable (is the backend running?)", status: r.status };
  }
  var all = r.json.datasets || [];
  if (!all.length) {
    return {
      datasets: [],
      hint:
        "The catalogue is empty. Build it from the Data Catalogue tab in the " +
        "VibeFoundry pane, or POST /api/catalog/build via vf_request.",
    };
  }
  // Exact dataset requested -> full column detail.
  if (args && args.dataset) {
    var hit = all.filter(function (d) { return d.name === args.dataset; })[0];
    if (!hit) {
      return { error: "no such dataset", available: all.map(function (d) { return d.name; }) };
    }
    return { dataset: hit };
  }
  // Otherwise a listing: enough to choose a file, not so much it floods context.
  var out = all.filter(function (d) { return matchesQuery(d, args && args.query); });
  return {
    folder: r.json.folder,
    built_at: r.json.built_at,
    datasets: out.map(function (d) {
      return {
        name: d.name,
        title: d.title,
        summary: d.summary,
        grain: d.grain,
        rows: d.rows,
        n_columns: d.n_columns,
        size_bytes: d.size_bytes,
        columns: (d.columns || []).map(function (c) {
          return { name: c.name, dtype: c.dtype, kind: c.kind, description: c.description };
        }),
        error: d.error,
      };
    }),
    hint:
      "To analyse one of these, pull it into input_folder first: POST " +
      "/api/sharepoint/download {serverRelativeUrl, destFolder:'input_folder'} " +
      "via vf_request. Call vf_catalog with `dataset` for full column stats.",
  };
}

async function proxyRequest(args) {
  var method = String(args.method || "GET").toUpperCase();
  var path = String(args.path || "/");
  if (path[0] !== "/") path = "/" + path;

  var opts = { method: method, headers: {} };
  if (args.body != null && method !== "GET" && method !== "HEAD") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
  }

  var r = await fetch(BACKEND + path, opts);
  var text = await r.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return {
    status: r.status,
    ok: r.ok,
    json: json,
    text: json == null ? text : null,
  };
}

// --- Minimal JSON-RPC / MCP loop ----------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function result(id, res) {
  send({ jsonrpc: "2.0", id: id, result: res });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
}

async function handle(msg) {
  var id = msg.id;
  var method = msg.method;
  var params = msg.params || {};
  var isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      return result(id, {
        // Echo the client's protocol version to avoid version mismatches.
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications get no response

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: [TOOL, PROXY_TOOL, CATALOG_TOOL] });

    case "tools/call": {
      var name = params.name;

      if (name === PROXY_TOOL.name) {
        var proxied = await proxyRequest(params.arguments || {});
        return result(id, {
          content: [{ type: "text", text: "HTTP " + proxied.status }],
          structuredContent: proxied,
        });
      }

      if (name === CATALOG_TOOL.name) {
        // The backend must be up to serve the catalogue; start it if it isn't,
        // so asking about data works without opening the pane first.
        await ensureBackend(null);
        var cat = await catalogTool(params.arguments || {});
        var summary = cat.error
          ? "Catalogue error: " + cat.error
          : cat.dataset
            ? "Profile for " + cat.dataset.name
            : (cat.datasets || []).length + " catalogued dataset(s)";
        return result(id, {
          content: [{ type: "text", text: summary }],
          structuredContent: cat,
        });
      }

      if (name !== TOOL.name) {
        return error(id, -32602, "Unknown tool: " + name);
      }
      var project = (params.arguments && params.arguments.project) || null;
      var backend = await ensureBackend(project);
      var message = backend.ok
        ? (backend.started
            ? "VibeFoundry backend started."
            : "VibeFoundry backend already running.")
        : "VibeFoundry pane opened, but the backend did not come up" +
          (backend.error ? " (" + backend.error + ")" : "") +
          " — set VF_BACKEND_CMD to the correct launch command.";
      if (project) message += " Project: " + project;
      return result(id, {
        content: [{ type: "text", text: message }],
        structuredContent: {
          status: backend.ok ? "ok" : "backend_down",
          message: message,
          backendUrl: BACKEND,
          backendReady: backend.ok,
          project: project,
        },
        _meta: TOOL_META,
      });
    }

    case "resources/list":
      return result(id, {
        resources: [
          {
            uri: WIDGET_URI,
            name: "VibeFoundry Pane",
            description: "The VibeFoundry IDE pane widget.",
            mimeType: WIDGET_MIME,
          },
        ],
      });

    case "resources/templates/list":
      return result(id, { resourceTemplates: [] });

    case "resources/read": {
      if (params.uri !== WIDGET_URI) {
        return error(id, -32602, "Unknown resource: " + params.uri);
      }
      var paneHtml = loadPaneHtml();
      return result(id, {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: WIDGET_MIME,
            // Serve the real built UI if available; else the placeholder shell.
            text: paneHtml || WIDGET_HTML.replace(/__BACKEND__/g, BACKEND),
            _meta: {
              "openai/widgetPrefersBorder": false,
              // Allow the widget iframe to talk to the local backend. If the
              // host honors this, localhost fetch/ws is permitted.
              ui: {
                csp: {
                  connectDomains: [BACKEND, BACKEND_WS],
                  resourceDomains: [],
                },
              },
            },
          },
        ],
      });
    }

    default:
      if (isRequest) error(id, -32601, "Method not found: " + method);
      return;
  }
}

// Read newline-delimited JSON from stdin.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      continue; // ignore malformed lines
    }
    Promise.resolve()
      .then(function () { return handle(msg); })
      .catch(function (e) {
        if (msg && msg.id != null) {
          error(msg.id, -32603, "Internal error: " + (e && e.message));
        }
      });
  }
});

function shutdown() {
  if (backendChild) {
    try { backendChild.kill(); } catch (e) {}
  }
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
