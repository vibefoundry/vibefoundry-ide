"use strict";

const fs = require("fs");
const path = require("path");

const SCAFFOLD_TOOL = {
  name: "scaffold_project",
  title: "Scaffold VibeFoundry Project",
  description:
    "Create the standard VibeFoundry project folders and copy the bundled " +
    "canonical AGENTS.md into the current Codex task root. This runs locally; " +
    "it does not call the hosted VibeFoundry MCP or download the rulebook.",
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      projectRoot: {
        type: "string",
        description:
          "Absolute path to the current Codex task working directory. Supply " +
          "this from task context and never ask the user for it.",
      },
      project_name: {
        type: "string",
        description: "Optional project name included in the result.",
      },
    },
    required: ["projectRoot"],
  },
};

const SETUP_TOOL = {
  name: "setup_vibefoundry",
  title: "Install VibeFoundry Runtime",
  description:
    "Return the exact OS-specific commands for installing the local " +
    "VibeFoundry runtime and vibe-coding toolchain, then registering the local " +
    "pane bridge with python -m vibefoundry.setup_codex. Detect the operating " +
    "system first, then run only the returned commands inside Codex.",
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      os: {
        type: "string",
        enum: ["mac", "windows"],
        description: "The detected operating system: mac or windows.",
      },
    },
    required: ["os"],
  },
};

function scaffoldProject(args) {
  var root = path.resolve(String((args && args.projectRoot) || ""));
  var stat;
  try {
    stat = fs.statSync(root);
  } catch (e) {
    throw new Error("The Codex task root does not exist: " + root);
  }
  if (!stat.isDirectory()) {
    throw new Error("The Codex task root is not a directory: " + root);
  }

  [
    "app_folder/scripts",
    "app_folder/meta_data",
    "input_folder",
    "output_folder",
  ].forEach(function (relative) {
    fs.mkdirSync(path.join(root, relative), { recursive: true });
  });

  var destination = path.join(root, "AGENTS.md");
  var createdAgents = false;
  if (!fs.existsSync(destination)) {
    var bundled = path.join(__dirname, "..", "templates", "AGENTS.md");
    fs.copyFileSync(bundled, destination);
    createdAgents = true;
  }

  var summary = createdAgents
    ? "Scaffolded the VibeFoundry project and installed the bundled AGENTS.md."
    : "Verified the VibeFoundry folders; the existing AGENTS.md was preserved.";
  return {
    content: [{ type: "text", text: summary + " Read AGENTS.md before continuing." }],
    structuredContent: {
      status: "ok",
      projectRoot: root,
      projectName: String((args && args.project_name) || ""),
      agentsPath: destination,
      agentsCreated: createdAgents,
      folders: [
        "app_folder/scripts",
        "app_folder/meta_data",
        "input_folder",
        "output_folder",
      ],
    },
  };
}

const SETUP_GUARDRAIL = [
  "Run only the commands below, in order, from inside Codex.",
  "Do not install an editor, Homebrew, or unrelated packages.",
  "The Python runtime owns the VibeFoundry implementation; the MCP bridge only launches it.",
  "If a command fails, diagnose or retry that command only.",
  "Tell the user which numbered step is running.",
].join(" ");

const MAC_SETUP = [
  '# Set up VibeFoundry - macOS (zsh)',
  'mkdir -p "$HOME/Documents/VibeFoundryProjects"',
  'cd "$HOME/Documents/VibeFoundryProjects"',
  'echo "[1/5] Checking Python and Miniconda..."',
  'if [ ! -x "$HOME/miniconda3/bin/python" ]; then MINICONDA_ARCH="MacOSX-arm64"; if [ "$(uname -m)" = "x86_64" ]; then MINICONDA_ARCH="MacOSX-x86_64"; fi; curl -fsSL "https://repo.anaconda.com/miniconda/Miniconda3-latest-${MINICONDA_ARCH}.sh" -o miniconda.sh; bash miniconda.sh -b -p "$HOME/miniconda3"; rm -f miniconda.sh; fi',
  'source "$HOME/miniconda3/etc/profile.d/conda.sh" && conda activate base',
  'echo "[2/5] Installing Node.js and Git..."',
  'conda install -y nodejs git',
  'echo "[3/5] Installing VibeFoundry and Python data libraries..."',
  'python -m pip install matplotlib plotly pandas numpy && python -m pip install -U vibefoundry',
  'echo "[4/5] Installing the Codex CLI..."',
  'npm install -g @openai/codex',
  'echo "[5/5] Verifying VibeFoundry and registering the pane..."',
  'python -c "import vibefoundry; print(\"VibeFoundry runtime ready\")"',
  'python -m vibefoundry.setup_codex',
].join("\n");

const WINDOWS_SETUP = [
  '# Set up VibeFoundry - Windows (PowerShell)',
  'New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\Documents\\VibeFoundryProjects" | Out-Null',
  'Set-Location "$env:USERPROFILE\\Documents\\VibeFoundryProjects"',
  'Write-Host "[1/5] Checking Python and Miniconda..."',
  'if (-not (Test-Path "$env:USERPROFILE\\miniconda3\\python.exe")) { curl.exe -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe -o miniconda.exe; if ($LASTEXITCODE -ne 0 -or -not (Test-Path miniconda.exe)) { Invoke-WebRequest -UseBasicParsing -Uri "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe" -OutFile miniconda.exe }; Start-Process -Wait -FilePath ".\\miniconda.exe" -ArgumentList "/InstallationType=JustMe","/AddToPath=1","/S","/D=$env:USERPROFILE\\miniconda3"; Remove-Item .\\miniconda.exe }',
  'Write-Host "[2/5] Installing Node.js and Git..."',
  '& "$env:USERPROFILE\\miniconda3\\Scripts\\conda.exe" install -y nodejs git',
  'Write-Host "[3/5] Installing VibeFoundry and Python data libraries..."',
  '& "$env:USERPROFILE\\miniconda3\\python.exe" -m pip install matplotlib plotly pandas numpy',
  '& "$env:USERPROFILE\\miniconda3\\python.exe" -m pip install -U vibefoundry',
  'Write-Host "[4/5] Installing the Codex CLI..."',
  'npm install -g @openai/codex',
  'Write-Host "[5/5] Verifying VibeFoundry and registering the pane..."',
  '& "$env:USERPROFILE\\miniconda3\\python.exe" -c "import vibefoundry; print(\'VibeFoundry runtime ready\')"',
  '& "$env:USERPROFILE\\miniconda3\\python.exe" -m vibefoundry.setup_codex',
].join("\n");

function buildSetupInstructions(os) {
  var commands = os === "windows" ? WINDOWS_SETUP : MAC_SETUP;
  return [
    SETUP_GUARDRAIL,
    "",
    commands,
    "",
    "When all five steps succeed, restart the Codex desktop app if needed, scaffold the current task root, and open VibeFoundry.",
  ].join("\n");
}

function setupVibeFoundry(args) {
  var os = String((args && args.os) || "").toLowerCase();
  if (os !== "mac" && os !== "windows") {
    throw new Error("Detect the operating system and pass os=mac or os=windows.");
  }
  var instructions = buildSetupInstructions(os);
  return {
    content: [{ type: "text", text: instructions }],
    // Ship the commands in structuredContent too: some clients surface only the
    // structured payload, and a bare {status} read as "no commands returned".
    structuredContent: {
      status: "commands_ready",
      os: os,
      guardrail: SETUP_GUARDRAIL,
      commands: os === "windows" ? WINDOWS_SETUP : MAC_SETUP,
    },
  };
}

module.exports = {
  tools: [SCAFFOLD_TOOL, SETUP_TOOL],
  scaffoldProject: scaffoldProject,
  setupVibeFoundry: setupVibeFoundry,
  buildSetupInstructions: buildSetupInstructions,
};
