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

// The OS assigns one free localhost port for this MCP session. Every
// open_vibefoundry call restarts the backend on that same port so the pane's
// backend URL and CSP stay stable for the lifetime of the conversation.
let BACKEND = null;
let SESSION_PORT = null;

// Link the tool to its widget template. We set BOTH known conventions so that
// whichever one this desktop-app build honors will match; extra keys are
// harmless if ignored.
const TOOL_META = {
  "openai/outputTemplate": WIDGET_URI,
  ui: { resourceUri: WIDGET_URI },
};

const SERVER_INFO = { name: "vibefoundry", version: "0.1.0" };

// Returned from initialize, so it frames the WHOLE session rather than one turn.
// MCP has no notion of a mode: the model re-decides which tools to call every
// turn and nothing a server returns can capture later prompts. Instructions are
// the strongest honest lever we have — they persist for the session and steer
// without pretending to control.
const SESSION_INSTRUCTIONS = [
  "VibeFoundry is a local data-science IDE. When it is open, the user's data and",
  "code live in a project folder on their machine, and this server is how you",
  "reach both. Prefer these tools over guessing, and never answer a question",
  "about the user's data from memory or assumption.",
  "",
  "Project layout — the project's AGENTS.md is authoritative, follow it exactly:",
  "  input_folder/          source data — SACRED, never edit or overwrite",
  "  output_folder/{task}/  where results are written",
  "  app_folder/scripts/{app}/  ALL code lives here, one folder per app",
  "  app_folder/meta_data/  generated digests of what's in input/output",
  "  templates/             templates already pulled into this project",
  "",
  "== A DATA QUESTION: look locally first, then the catalogue ==",
  "  1. Start with the project's own data. Read",
  "     app_folder/meta_data/input_metadata.txt (a digest of every file in",
  "     input_folder: columns, row counts, date columns) via vf_request, and list",
  "     input_folder with /api/files/tree. If the answer is there, use it — the",
  "     data is already local and needs no pulling.",
  "  2. If input_folder can't answer it — no such dataset, missing columns, wrong",
  "     period, digest says 'No data files found' — then assume the answer lives",
  "     in the Data Catalogue. Call vf_catalog to search the connected SharePoint",
  "     library: it gives each dataset's description, what one row represents,",
  "     row counts and column profiles (distinct values for categoricals,",
  "     min/max/mean for continuous, real date ranges for temporal). Use",
  "     vf_catalog with `dataset` for one dataset's full profile.",
  "  3. Having picked a dataset, pull it into input_folder before analysing it:",
  "     vf_request POST /api/sharepoint/download",
  "     {serverRelativeUrl: '<catalogue folder>/<path>', destFolder: 'input_folder'}",
  "  Never invent filenames, columns or values at any step. If neither local data",
  "  nor the catalogue can answer, say so and point the user at the Data",
  "  Catalogue tab.",
  "",
  "== BUILDING AN APP: AGENTS.md, and start from a template ==",
  "  - Read the project's AGENTS.md first and follow it exactly — the track",
  "    choice, the folder structure, run_app.sh/.bat, 'input is sacred'. Never",
  "    stray from it or invent your own structure. It sits at the project root;",
  "    if there isn't one the project was never scaffolded — call",
  "    scaffold_project and RUN the commands it returns to create it, rather",
  "    than proceeding with no rules or writing your own AGENTS.md.",
  "  - Always look for an existing template before writing anything: list the",
  "    project's templates/ folder (vf_request /api/files/tree). If one fits,",
  "    start from it.",
  "  - If templates/ has nothing suitable, pull one from the VibeFoundry template",
  "    library rather than starting from scratch:",
  "      vf_request GET  /api/templates/catalog        (what's available)",
  "      vf_request POST /api/templates/download {id}  (into templates/)",
  "    Then use it as the starting point.",
  "  - Only write an app from scratch if the library genuinely has nothing close.",
  "",
  "vf_request reaches any backend endpoint (files, previews, running scripts)",
  "when no dedicated tool fits.",
  "",
  "== LOCAL SETUP ==",
  "  - The public onboarding MCP lives at https://vibefoundry.ai/mcp. It returns",
  "    install/scaffold commands and finishes by running python -m",
  "    vibefoundry.setup_codex.",
  "  - After that, this local stdio bridge is the thin launcher/communicator:",
  "    it opens the pane, starts the Python runtime, and proxies UI/backend",
  "    requests. The Python vibefoundry package owns the IDE behavior.",
  "  - scaffold_project creates the standard folders and copies the bundled",
  "    canonical AGENTS.md into the current task root without using HTTP.",
  "  - setup_vibefoundry returns the exact OS-specific runtime commands used by",
  "    the $installmcp skill. Run only those commands and honor Codex approvals.",
].join("\n");

// --- Backend supervision -------------------------------------------------------
// The MCP server auto-starts the VibeFoundry FastAPI backend so the user never
// has to. Command is configurable via VF_BACKEND_CMD; the default assumes the
// `vibefoundry` console script is installed (pip). We run it through a LOGIN
// shell so it inherits the user's full PATH — GUI-launched processes on macOS
// otherwise get a minimal PATH that won't find pip/homebrew binaries.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");
const installTools = require("./install-tools");

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
  return String(SESSION_PORT || "");
}
function backendWs() {
  return BACKEND && BACKEND.replace(/^http/, "ws");
}
function backendCmd() {
  if (process.env.VF_BACKEND_CMD) {
    return process.env.VF_BACKEND_CMD.replace(/\{port\}/g, backendPort());
  }
  return "vibefoundry --port " + backendPort() + " --no-browser";
}

// --- Session port ---------------------------------------------------------------
const net = require("net");

// Port 0 asks the OS for any available ephemeral localhost port. Cache the
// result so every backend launched by this MCP conversation uses the same URL.
function ensureSessionPort() {
  if (SESSION_PORT) return Promise.resolve(SESSION_PORT);
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", function () {
      var address = srv.address();
      var port = address && address.port;
      srv.close(function () {
        if (!port) {
          reject(new Error("the operating system did not assign a localhost port"));
          return;
        }
        SESSION_PORT = port;
        BACKEND = "http://127.0.0.1:" + port;
        resolve(port);
      });
    });
  });
}

function portIsOpen(port) {
  return new Promise(function (resolve) {
    var socket = net.createConnection({ host: "127.0.0.1", port: port });
    socket.once("connect", function () { socket.destroy(); resolve(true); });
    socket.once("error", function () { resolve(false); });
    socket.setTimeout(200, function () { socket.destroy(); resolve(false); });
  });
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

async function stopBackend() {
  if (!backendAlive()) {
    backendChild = null;
    return;
  }
  var oldPort = Number(backendPort());
  killBackend();
  for (var i = 0; i < 20; i++) {
    if (!(await portIsOpen(oldPort))) return;
    await sleep(100);
  }
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

function backendHealth(timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
  return fetch(BACKEND + "/api/health", { signal: ctrl.signal })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (health) { clearTimeout(t); return health; });
}

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

async function startFreshBackend(project) {
  var port = await ensureSessionPort();
  await stopBackend();

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
      var args = ["-m", "vibefoundry", "--port", String(port), "--no-browser", project];
      backendChild = spawn(py, args, opts);
    } else {
      // Fallback: run VF_BACKEND_CMD through the platform's shell (NOT /bin/zsh on Windows).
      var cmd = backendCmd() + ' "' + String(project).replace(/"/g, '\\"') + '"';
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

  // Poll for readiness (~20s).
  for (var i = 0; i < 40; i++) {
    await sleep(500);
    var health = await backendHealth(800);
    if (health && health.status === "ok") {
      if (!samePath(health.project_folder, project)) {
        killBackend();
        return {
          started: true,
          ok: false,
          port: backendPort(),
          error: "backend opened the wrong project: " + (health.project_folder || "(none)"),
        };
      }
      return { started: true, ok: true, port: backendPort() };
    }
  }
  killBackend();
  return { started: true, ok: false, port: backendPort() };
}

let backendLaunchQueue = Promise.resolve();
function queueFreshBackend(project) {
  var launch = backendLaunchQueue.then(function () {
    return startFreshBackend(project);
  });
  backendLaunchQueue = launch.catch(function () {});
  return launch;
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
  title: "Open VibeFoundry",
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
    "a fullscreen pane. Pass the current Codex task's working directory as " +
    "`projectRoot`; the user should never need to provide it. It starts a fresh " +
    "backend for that project. Match generously through misspellings, " +
    "transpositions, spacing, and abbreviations — e.g. \"open vfoundry\", " +
    "\"open videfoundry\", \"open vibe foundry\", \"open vibefoundy\", " +
    "\"open VF\" all refer to VibeFoundry and MUST trigger this tool.",
  inputSchema: {
    type: "object",
    properties: {
      projectRoot: {
        type: "string",
        description:
          "Absolute path to the current Codex task's working directory. Supply " +
          "this automatically from task context; never ask the user for it.",
      },
    },
    required: ["projectRoot"],
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: false,
  },
  _meta: TOOL_META,
};

// Generic proxy: the pane can't reach localhost (sandbox), but this Node process
// can. The widget calls this tool via window.openai.callTool("vf_request", ...)
// and we forward the request to the local FastAPI backend. One tool = the whole
// backend, unchanged.
const PROXY_TOOL = {
  name: "vf_request",
  title: "VibeFoundry Backend Request",
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
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
    readOnlyHint: false,
  },
};

// The catalogue, exposed to the model. This is the point of the whole feature:
// when the user asks "show me sales for the last 2 months", the model reads this
// to work out WHICH dataset holds sales, what one row means, which column is the
// date, and what the values look like — before pulling anything.
const CATALOG_TOOL = {
  name: "vf_catalog",
  title: "VibeFoundry Data Catalogue",
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
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
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

let nextClientRequestId = 0;
const pendingClientRequests = new Map();

function requestClient(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var id = "vibefoundry-" + (++nextClientRequestId);
    var timer = setTimeout(function () {
      pendingClientRequests.delete(id);
      reject(new Error(method + " timed out"));
    }, timeoutMs || 5000);
    pendingClientRequests.set(id, {
      resolve: function (value) { clearTimeout(timer); resolve(value); },
      reject: function (err) { clearTimeout(timer); reject(err); },
    });
    send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
  });
}

function handleClientResponse(msg) {
  var pending = pendingClientRequests.get(msg.id);
  if (!pending) return false;
  pendingClientRequests.delete(msg.id);
  if (msg.error) {
    pending.reject(new Error(msg.error.message || "client request failed"));
  } else {
    pending.resolve(msg.result);
  }
  return true;
}

async function activeProjectRoot(projectRoot) {
  if (projectRoot) {
    return resolveProjectRoot(projectRoot, "Codex's current working directory");
  }

  try {
    var result = await requestClient("roots/list", {}, 5000);
    var roots = (result && result.roots) || [];
    if (roots.length) {
      var root = roots[0];
      if (!root.uri || !String(root.uri).startsWith("file:")) {
        throw new Error("Codex's active project root is not a local filesystem folder");
      }
      return resolveProjectRoot(fileURLToPath(root.uri), "Codex's active project root");
    }
  } catch (e) {
    if (!String(e && e.message).includes("timed out")) {
      throw e;
    }
  }

  throw new Error(
    "Codex did not provide the current task root. Call open_vibefoundry with " +
    "projectRoot set to the current task's working directory."
  );
}

function resolveProjectRoot(project, label) {
  var stat;
  try {
    stat = fs.statSync(project);
  } catch (e) {
    throw new Error(label + " does not exist: " + project);
  }
  if (!stat.isDirectory()) {
    throw new Error(label + " is not a directory: " + project);
  }
  return path.resolve(project);
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
        instructions: SESSION_INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications get no response

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: [TOOL, PROXY_TOOL, CATALOG_TOOL].concat(installTools.tools),
      });

    case "tools/call": {
      var name = params.name;

      if (name === "scaffold_project") {
        var scaffoldArgs = params.arguments || {};
        scaffoldArgs.projectRoot = await activeProjectRoot(scaffoldArgs.projectRoot);
        return result(id, installTools.scaffoldProject(scaffoldArgs));
      }

      if (name === "setup_vibefoundry") {
        return result(id, installTools.setupVibeFoundry(params.arguments || {}));
      }

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
        if (!backendAlive() || !(await backendHealth(800))) {
          await queueFreshBackend(await activeProjectRoot());
        }
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
      var project = await activeProjectRoot(
        params.arguments && params.arguments.projectRoot
      );
      var backend = await queueFreshBackend(project);
      var message = backend.ok
        ? "VibeFoundry backend started."
        : "VibeFoundry pane opened, but the backend did not come up" +
          (backend.error ? " (" + backend.error + ")" : "") +
          " — set VF_BACKEND_CMD to the correct launch command.";
      message += " Project: " + project;

      // Launching is the moment to frame the rest of the conversation. The model
      // reads this reply, so it's where "from here on, work through VibeFoundry"
      // actually lands — initialize's instructions can be far up the context by
      // now. Still steering, not enforcement: the model chooses each turn.
      var folder = null;
      try {
        var info = await (await fetch(BACKEND + "/api/health")).json();
        folder = info && info.project_folder;
      } catch (e) { /* backend may still be waking */ }

      var catalogued = 0;
      try {
        var cat = await (await fetch(BACKEND + "/api/catalog")).json();
        catalogued = ((cat && cat.datasets) || []).length;
      } catch (e) { /* no catalogue yet */ }

      // Report what's ACTUALLY there rather than describing the layout in the
      // abstract — the model shouldn't have to go looking to learn whether
      // input_folder is empty or which templates are already pulled.
      var localFiles = [];
      var templates = [];
      var hasAgents = false;
      try {
        var tree = await (await fetch(BACKEND + "/api/files/tree")).json();
        var walk = function (node, into) {
          (node.children || []).forEach(function (c) {
            if (!c.isDirectory) into.push(c.name);
          });
        };
        ((tree.tree && tree.tree.children) || []).forEach(function (top) {
          if (top.name === "input_folder") walk(top, localFiles);
          if (top.name === "templates") (top.children || []).forEach(function (c) {
            if (c.isDirectory) templates.push(c.name);
          });
          // "Follow AGENTS.md" is useless if there isn't one — it's created by
          // scaffold_project, so an unscaffolded project has none, and the model
          // silently has no rules to follow. Say which it is.
          if (!top.isDirectory && top.name === "AGENTS.md") hasAgents = true;
        });
      } catch (e) { /* tree unavailable — fall back to the generic brief */ }

      var brief = backend.ok
        ? [
            message,
            "",
            "VibeFoundry is now the user's working environment for this",
            "conversation. Treat their data and code as living here, and work",
            "through this server rather than assuming or improvising.",
            "",
            folder ? "  Project folder: " + folder : "  No project folder selected yet.",
            "  input_folder/ : " + (localFiles.length
              ? localFiles.length + " file(s) — " + localFiles.slice(0, 6).join(", ")
              : "empty"),
            "  templates/    : " + (templates.length ? templates.join(", ") : "none pulled yet"),
            "  Catalogue     : " + (catalogued
              ? catalogued + " SharePoint dataset(s) described — call vf_catalog"
              : "empty (build it from the Data Catalogue tab)"),
            "  AGENTS.md     : " + (hasAgents
              ? "present at the project root — READ IT before building anything"
              : "MISSING. Call scaffold_project and RUN the commands it returns to "
                + "create it, before building anything."),
            "",
            "DATA QUESTIONS — look locally first, then the catalogue:",
            "  1. Check the project's own data: read",
            "     app_folder/meta_data/input_metadata.txt (digest of input_folder:",
            "     columns, row counts, dates) via vf_request. If it answers the",
            "     question, use it — nothing to pull.",
            "  2. If input_folder can't answer it, assume the answer is in the Data",
            "     Catalogue: call vf_catalog to find the right SharePoint dataset,",
            "     then pull it in via POST /api/sharepoint/download",
            "     {serverRelativeUrl, destFolder:'input_folder'}.",
            "  Never invent filenames, columns or values. Never answer from memory.",
            "",
            "BUILDING AN APP — AGENTS.md, and never from scratch:",
            hasAgents
              ? "  - Read the project's AGENTS.md and follow it exactly. Do not stray."
              : "  - There is no AGENTS.md. Create one first via scaffold_project"
                + " (run the commands it returns), then follow it exactly.",
            "  - Look in templates/ first" + (templates.length
              ? " (already there: " + templates.join(", ") + ")."
              : " (currently empty)."),
            "  - If nothing fits, pull one from the library before writing code:",
            "    GET /api/templates/catalog, then POST /api/templates/download.",
            "    Only build from scratch if the library has nothing close.",
          ].join("\n")
        : message;

      return result(id, {
        content: [{ type: "text", text: brief }],
        structuredContent: {
          status: backend.ok ? "ok" : "backend_down",
          message: message,
          backendUrl: BACKEND,
          backendReady: backend.ok,
          project: project,
          projectFolder: folder,
          cataloguedDatasets: catalogued,
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
      await ensureSessionPort();
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
                  // Derived at use time, not cached: BACKEND is chosen when the
                  // backend starts, so a constant captured at load would name
                  // the wrong port (and BACKEND_WS as a const didn't survive
                  // the port becoming dynamic — resources/read threw
                  // "BACKEND_WS is not defined" and the pane wouldn't load).
                  connectDomains: [BACKEND, backendWs()],
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
    if (msg.method == null && msg.id != null && handleClientResponse(msg)) {
      continue;
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
