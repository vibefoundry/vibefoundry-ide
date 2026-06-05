"""
publish.py — turn this codex chatbot template into a distributable desktop app.

This is the conda-pack publisher: it builds a SINGLE self-contained runtime
(Python + Node + Git + the app's deps), packs it with conda-pack, bundles the
codex CLI, and emits an installer that just UNPACKS it. The end-user install
downloads NOTHING.

It runs on the developer's machine and emits, under published_apps/<slug>_<os>_v{N}/:

    install.command / install.bat   (the user runs one once — fully offline)
    application_core/               (backend + built frontend + data + env.tar.gz
                                     + bundled codex + icons)

The end user double-clicks the installer, which unpacks the runtime into
~/Documents/VibeFoundryApplications/<slug>/ (mac) or the Windows equivalent,
runs conda-unpack to relocate it, and drops a branded Desktop launcher. No
Miniforge download, no conda solve, no pip install, no npm install.

IMPORTANT — conda-pack cannot cross-build. A package is built FOR the OS it is
built ON: run this on a Mac to produce the macOS package, and run the SAME script
on a Windows x64 machine to produce the Windows package. There is no way to emit
both from one machine; the packed runtime contains native binaries for one OS.

Usage:
    python publish.py "My App Name"
    python publish.py            # prompts for the name

Build env needs: a working conda/Miniforge (to create + pack the env) and internet
(to fetch conda-forge packages, the app's pip deps, and the codex CLI — all at
BUILD time only). macOS target is Apple Silicon (arm64); Windows target is x64.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# This script lives in the template's Publish/ folder, alongside vf_logo.png, so
# the publishing tooling + logo travel WITH the template when it's pulled. The
# template's own files (backend/, frontend/, data/) sit one level up.
SCRIPT_DIR = Path(__file__).resolve().parent          # .../<template>/Publish
TEMPLATE_DIR = SCRIPT_DIR.parent                      # .../<template>
PUBLISHED_DIR = SCRIPT_DIR / "published_apps"         # build output lives in Publish/
FRONTEND_DIR = TEMPLATE_DIR / "frontend"
BACKEND_DIR = TEMPLATE_DIR / "backend"
DATA_DIR = TEMPLATE_DIR / "data"
LOGO = SCRIPT_DIR / "vf_logo.png"  # ships next to this script in Publish/

TARGET_PY = "3.12"          # the Python the packed runtime is built on
WIN = os.name == "nt"       # building on Windows?

# Host OS -> tag for the package folder. conda-pack builds for the host only,
# so this both names the output and signals which OS the package is for.
if sys.platform == "darwin":
    OS_TAG = "mac"
elif WIN:
    OS_TAG = "win"
else:
    OS_TAG = "linux"


def banner(msg: str) -> None:
    line = "=" * 64
    print(f"\n{line}\n {msg}\n{line}")


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    """Run a command, streaming output; raise with a clear message on failure."""
    printable = " ".join(str(c) for c in cmd)
    print(f"  $ {printable}")
    # On Windows, npm/node (and other tools) ship as .cmd shims that CreateProcess
    # can't launch by bare name — subprocess.run(["npm", ...]) fails with WinError 2.
    # Running through the shell lets cmd.exe resolve them (list2cmdline quotes args).
    result = subprocess.run(cmd, cwd=str(cwd) if cwd else None, shell=WIN, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {printable}")


# --- naming + versioning ------------------------------------------------------

def slugify(name: str) -> str:
    """A filesystem/conda-safe slug: lowercase, alnum + underscore, no leading digit."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    if not slug:
        slug = "app"
    if slug[0].isdigit():
        slug = f"app_{slug}"
    return slug


def next_version_dir(parent: Path, basename: str) -> Path:
    """parent/<basename>_v<N>, N one past the highest existing — never overwrites."""
    highest = 0
    if parent.is_dir():
        for child in parent.iterdir():
            m = re.fullmatch(rf"{re.escape(basename)}_v(\d+)", child.name)
            if m and child.is_dir():
                highest = max(highest, int(m.group(1)))
    return parent / f"{basename}_v{highest + 1}"


# --- conda discovery ----------------------------------------------------------

def find_conda() -> str:
    """Locate a conda executable on the build machine, or fail with a clear message."""
    exe = os.environ.get("CONDA_EXE")
    if exe and Path(exe).exists():
        return exe
    found = shutil.which("conda")
    if found:
        return found
    raise RuntimeError(
        "conda not found. This publisher needs a working conda/Miniforge on the\n"
        "  build machine to create and pack the runtime. Install Miniforge and retry."
    )


def ensure_conda_pack(conda: str) -> None:
    """Make sure conda-pack is importable in the base env; install it if missing.
    conda-pack is a pure-python build tool — it is NOT shipped to users."""
    probe = subprocess.run(
        [conda, "run", "-n", "base", "python", "-c", "import conda_pack"],
        capture_output=True, shell=WIN,
    )
    if probe.returncode == 0:
        return
    print("  conda-pack not present in base env; installing it (build tool only)...")
    run([conda, "install", "-n", "base", "-y", "-c", "conda-forge", "conda-pack"])


# --- build stages -------------------------------------------------------------

def _square_logo():
    """Load vf_logo.png padded onto a transparent square canvas (a PIL image)."""
    from PIL import Image
    img = Image.open(LOGO).convert("RGBA")
    side = max(img.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return square


def build_frontend(core: Path, app_name: str) -> None:
    """npm ci + vite build, then stage the static output at application_core/frontend_dist.
    The app calls /api with relative paths, so the built bundle works same-origin
    under Flask with no proxy. Post-build, brands the window title and drops the
    PWA pieces (favicon, manifest, icons, service worker) into the dist root so
    the app is installable as a standalone, own-icon PWA."""
    run(["npm", "ci"], cwd=FRONTEND_DIR)
    run(["npm", "run", "build"], cwd=FRONTEND_DIR)
    dist = FRONTEND_DIR / "dist"
    if not dist.is_dir():
        raise RuntimeError(f"vite build produced no dist/ at {dist}")

    # Brand the window title with the app name.
    index = dist / "index.html"
    if index.is_file():
        html = index.read_text(encoding="utf-8")
        html = re.sub(r"<title>.*?</title>", f"<title>{app_name}</title>", html, count=1)
        index.write_text(html, encoding="utf-8")

    # PWA assets at the dist root (index.html links /vf_logo.png, /manifest.webmanifest, /sw.js).
    if LOGO.exists():
        square = _square_logo()
        square.resize((256, 256)).save(dist / "vf_logo.png")
        square.resize((192, 192)).save(dist / "icon-192.png")
        square.resize((512, 512)).save(dist / "icon-512.png")
    (dist / "manifest.webmanifest").write_text(_manifest_json(app_name), encoding="utf-8")
    (dist / "sw.js").write_text(SERVICE_WORKER_JS, encoding="utf-8")

    shutil.copytree(dist, core / "frontend_dist")


def _manifest_json(app_name: str) -> str:
    import json
    name = app_name[:45]
    return json.dumps({
        "name": app_name,
        "short_name": name,
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0f1115",
        "theme_color": "#0f1115",
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }, indent=2)


# Minimal pass-through service worker: present so Chrome treats the app as an
# installable PWA, but it does NOT cache (a local app is always served fresh).
SERVICE_WORKER_JS = """\
self.addEventListener('install', function (e) { self.skipWaiting() })
self.addEventListener('activate', function (e) { self.clients.claim() })
self.addEventListener('fetch', function () { /* pass-through: default network */ })
"""


def build_runtime(package: Path, core: Path) -> None:
    """Create a self-contained conda env (Python + Node + Git + the app's pip deps),
    bundle the codex CLI alongside it, and conda-pack the env into env.tar.gz.

    Everything here happens on the BUILD machine and targets the HOST OS. The
    result downloads nothing at install time. The throwaway build env is deleted
    after packing so only the tarball + the codex prefix ship."""
    conda = find_conda()
    ensure_conda_pack(conda)

    build_env = package / "_build_env"          # throwaway; removed after packing
    if build_env.exists():
        shutil.rmtree(build_env)

    # 1. Create the env from conda-forge (matches the Miniforge channel set, and
    #    avoids the Anaconda defaults channel's commercial terms).
    print("  creating runtime env (python + nodejs + git) from conda-forge...")
    run([conda, "create", "-p", str(build_env), "-y",
         "-c", "conda-forge", "--override-channels",
         f"python={TARGET_PY}", "pip", "nodejs", "git"])

    # 2. Install the app's Python deps INTO the env (replaces wheel vendoring —
    #    they ride along inside the packed runtime).
    py = build_env / ("python.exe" if WIN else "bin/python")
    print("  installing app deps into the env...")
    run([str(py), "-m", "pip", "install", "-r", str(BACKEND_DIR / "requirements.txt")])

    # 3. Bundle the codex CLI into a shipped npm prefix (core/npm). npm resolves
    #    the per-OS codex binary for THIS machine automatically, so the host build
    #    gets the right binary — no cross-platform fetch needed.
    bundle_codex(build_env, core)

    # 4. conda-pack the env into a relocatable tarball; the installer untars it and
    #    runs conda-unpack on the user's machine.
    print("  conda-pack -> env.tar.gz (this takes a minute)...")
    out = core / "env.tar.gz"
    run([conda, "run", "-n", "base", "conda-pack",
         "-p", str(build_env), "-o", str(out), "--n-threads", "-1"])

    # 5. Drop the throwaway build env; only env.tar.gz + npm/ ship.
    shutil.rmtree(build_env, ignore_errors=True)
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"  packed runtime: {size_mb:.0f} MB")


def bundle_codex(build_env: Path, core: Path) -> None:
    """Install @openai/codex into core/npm using the freshly built env's npm.
    npm selects the per-OS native binary for the build host (via the package's
    os/cpu optionalDependencies), so the bundled codex matches this OS."""
    npm_prefix = core / "npm"
    npm_prefix.mkdir(parents=True, exist_ok=True)
    if WIN:
        npm = build_env / "npm.cmd"
        node_bin = build_env
    else:
        npm = build_env / "bin" / "npm"
        node_bin = build_env / "bin"
    env = os.environ.copy()
    env["NPM_CONFIG_PREFIX"] = str(npm_prefix)
    env["PATH"] = str(node_bin) + os.pathsep + env.get("PATH", "")
    print("  bundling codex CLI into the package (host-OS binary)...")
    run([str(npm), "install", "-g", "@openai/codex"], env=env)


def assemble(core: Path) -> None:
    """Copy backend + data into application_core. (No wheels: the deps are inside
    the packed runtime.)"""
    shutil.copytree(
        BACKEND_DIR, core / "backend",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    if DATA_DIR.is_dir():
        shutil.copytree(DATA_DIR, core / "data",
                        ignore=shutil.ignore_patterns("__pycache__"))
    else:
        (core / "data").mkdir(parents=True, exist_ok=True)


def make_icons(core: Path, slug: str) -> None:
    """vf_logo.png -> <slug>.ico (Pillow), <slug>.icns (iconutil), and a
    vf_logo.png the splash page shows. Source is padded to square first."""
    if not LOGO.exists():
        print(f"  ! logo not found at {LOGO}; skipping icons")
        return
    import tempfile
    from PIL import Image
    img = Image.open(LOGO).convert("RGBA")
    side = max(img.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))

    # Windows .ico
    square.save(core / f"{slug}.ico",
                sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"  wrote {slug}.ico")

    # Splash logo (the branded loading screen shows this).
    square.resize((256, 256)).save(core / "vf_logo.png")

    # macOS .icns via an .iconset + iconutil (sips' direct icns conversion is
    # unreliable — Error 13 — so we build the iconset with Pillow ourselves).
    try:
        iconset = Path(tempfile.mkdtemp()) / "icon.iconset"
        iconset.mkdir()
        for s in (16, 32, 128, 256, 512):
            square.resize((s, s)).save(iconset / f"icon_{s}x{s}.png")
            square.resize((s * 2, s * 2)).save(iconset / f"icon_{s}x{s}@2x.png")
        run(["iconutil", "-c", "icns", str(iconset), "-o", str(core / f"{slug}.icns")])
        print(f"  wrote {slug}.icns")
    except (RuntimeError, FileNotFoundError):
        print("  ! iconutil unavailable; skipping .icns (fine for a Windows-only build)")


# --- emitted end-user scripts -------------------------------------------------

def _fill(template: str, app_name: str, slug: str) -> str:
    return (template
            .replace("__APP_NAME__", app_name)
            .replace("__SLUG__", slug))


RUN_APP_COMMAND = r"""#!/bin/bash
# __APP_NAME__ — runs in this Terminal window so everything is visible/debuggable.
# Starts the server in the foreground and opens the app window. Close this window
# (or Ctrl+C) to quit. Output stays on screen so any failure is right here.
CORE_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=========================================="
echo " __APP_NAME__"
echo " folder: $CORE_DIR"
echo "=========================================="
PORTFILE="$CORE_DIR/.server_port"
ENV="$CORE_DIR/env"

open_app_window() {  # $1 = port. Chromeless app-mode window on the splash, which
  # polls the port and redirects IN-PLACE to the app when ready.
  echo "window.APP_PORT=$1;" > "$CORE_DIR/port.js"
  URL="file://$CORE_DIR/splash.html"
  for B in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$B" ]; then echo "opening window via $B"; "$B" --app="$URL" --window-size=1200,820 >/dev/null 2>&1 & return 0; fi
  done
  echo "no Chromium browser found — opening in default browser"
  open "$URL"
}

# Single-instance: if a server is already live, just reopen the app window to it.
if [ -f "$PORTFILE" ]; then
  EXISTING="$(cat "$PORTFILE" 2>/dev/null)"
  if [ -n "$EXISTING" ] && curl -s -o /dev/null "http://localhost:$EXISTING/api/health"; then
    echo "already running on port $EXISTING — opening window"
    open_app_window "$EXISTING"
    exit 0
  fi
fi

echo "[1/2] reserving a port..."
PORTS="$("$ENV/bin/python" "$CORE_DIR/backend/_pick_port.py")"
BACKEND_PORT="${PORTS%% *}"
echo "      port: $BACKEND_PORT"
open_app_window "$BACKEND_PORT"
# codex (bundled npm prefix) + the packed runtime on PATH for the agent subprocess.
export PATH="$CORE_DIR/npm/bin:$ENV/bin:$PATH"
export CODEX_HOME="$CORE_DIR/codex_home"
mkdir -p "$CODEX_HOME"   # codex requires CODEX_HOME to be an existing directory
export BACKEND_PORT VF_PUBLISHED=1
cd "$CORE_DIR"
echo "[2/2] starting server (logs below) ..."
echo "------------------------------------------"
"$ENV/bin/python" backend/app.py
CODE=$?
echo "------------------------------------------"
echo "server exited (code $CODE). Press Enter to close this window."
read _
"""

RUN_APP_BAT = r"""@echo off
setlocal enabledelayedexpansion
REM __APP_NAME__ — runs in this console window so everything is visible/debuggable.
REM Foreground server; close this window to quit. Mirrors the macOS .command.
echo ==========================================
echo  __APP_NAME__
echo  folder: %~dp0
echo ==========================================
set "CORE_DIR=%~dp0"
set "PORTFILE=%CORE_DIR%.server_port"
set "ENV=%CORE_DIR%env"

REM file:// URL to the splash (browsers want forward slashes).
set "SPLASH=file:///%CORE_DIR%splash.html"
set "SPLASH=!SPLASH:\=/!"

REM Find a Chromium browser so we can open a chromeless app-mode window.
set "BROWSER="
for %%p in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do ( if exist "%%~p" if not defined BROWSER set "BROWSER=%%~p" )

REM Single-instance: if a server is already live, just reopen the app window.
if exist "%PORTFILE%" (
  set /p EXISTING=<"%PORTFILE%"
  curl -s -o nul "http://localhost:!EXISTING!/api/health"
  if not errorlevel 1 (
    echo already running on port !EXISTING! - opening window
    > "%CORE_DIR%port.js" echo window.APP_PORT=!EXISTING!;
    call :openwin
    exit /b 0
  )
)

echo [1/2] reserving a port...
REM codex (bundled npm prefix) + the packed runtime on PATH; env python via full path.
set "PATH=%CORE_DIR%npm;%ENV%;%ENV%\Scripts;%ENV%\Library\bin;%PATH%"
set "CODEX_HOME=%CORE_DIR%codex_home"
if not exist "%CODEX_HOME%" mkdir "%CODEX_HOME%"
REM Reserve a port. Do NOT use `for /f` on a quoted command here: when the line
REM has two quoted paths, cmd strips the outer quote pair and the command breaks
REM (-> empty port -> "could not determine app port"). Capture to a file instead.
"%ENV%\python.exe" "%CORE_DIR%backend\_pick_port.py" > "%CORE_DIR%_port.txt" 2>nul
set "PORTS="
set /p PORTS=<"%CORE_DIR%_port.txt"
del "%CORE_DIR%_port.txt" >nul 2>&1
for /f "tokens=1" %%a in ("%PORTS%") do set "BACKEND_PORT=%%a"
echo       port: %BACKEND_PORT%
> "%CORE_DIR%port.js" echo window.APP_PORT=%BACKEND_PORT%;
call :openwin
cd /d "%CORE_DIR%"
set "VF_PUBLISHED=1"
echo [2/2] starting server (logs below) ...
echo ------------------------------------------
REM Foreground (python, not pythonw) so logs show in this window.
"%ENV%\python.exe" backend\app.py
echo ------------------------------------------
echo server exited (code %ERRORLEVEL%). Press any key to close.
pause >nul
exit /b 0

:openwin
if defined BROWSER ( start "" "!BROWSER!" --app="!SPLASH!" --window-size=1200,820 ) else ( start "" "%CORE_DIR%splash.html" )
goto :eof
"""

SPLASH_HTML = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="vf_logo.png">
<title>__APP_NAME__</title>
<style>
  html,body{margin:0;height:100%}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:#ffffff;color:#1a1a1a}
  img{width:96px;height:96px;object-fit:contain;margin-bottom:26px}
  .spin{width:30px;height:30px;border:3px solid #e5e7eb;border-top-color:#7c5cff;
    border-radius:50%;animation:s .9s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{font-size:18px;font-weight:600;margin:20px 0 6px}
  p{color:#6b7280;font-size:13px;margin:0}
</style></head>
<body>
  <img src="vf_logo.png" alt="">
  <div class="spin"></div>
  <h1>Starting __APP_NAME__…</h1>
  <p id="msg">This can take a few seconds on first launch…</p>
  <script src="port.js"></script>
  <script>
    var port = window.APP_PORT;
    if (!port) { document.getElementById('msg').textContent = 'Could not determine the app port.'; }
    else {
      var appUrl = 'http://localhost:' + port + '/';
      (function poll(){
        fetch(appUrl + 'api/health', {mode:'no-cors'})
          .then(function(){ location.href = appUrl; })
          .catch(function(){ setTimeout(poll, 600); });
      })();
    }
  </script>
</body></html>
"""

INSTALL_COMMAND = r"""#!/bin/bash
# Installer for __APP_NAME__ (macOS, Apple Silicon). Run once. FULLY OFFLINE.
#
# Unpacks a self-contained runtime (Python + Node + Git + codex + the app) into
# ~/Documents/VibeFoundryApplications/__SLUG__/ and relocates it with conda-unpack.
# Nothing is downloaded; nothing is written to your shell or PATH. The folder is
# SPACE-FREE (conda-pack relocation refuses prefixes with spaces). The package you
# ran this from can be deleted afterwards. Uninstall = delete the install folder +
# the Desktop icon.
PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$PKG_DIR/application_core"
APP_NAME="__APP_NAME__"
SLUG="__SLUG__"
DEST="$HOME/Documents/VibeFoundryApplications/$SLUG"
ENV="$DEST/env"
# Write the install log straight to the Desktop so it's always there afterward.
LOG="$HOME/Desktop/${APP_NAME}_install_log.txt"; : > "$LOG"
TOTAL=3
SPIN='|/-\'

draw() {  # $1 completed steps, $2 label, $3 spinner char
  local done=$1 label="$2" sp="${3:- }" width=22 filled i bar=""
  filled=$(( done * width / TOTAL ))
  for ((i=0;i<width;i++)); do if ((i<filled)); then bar+="#"; else bar+="."; fi; done
  printf "\r  [%s] %d/%d  %s %-26s" "$bar" "$done" "$TOTAL" "$sp" "$label"
}
fail() {  # $1 step num, $2 label — clean on success, informative on failure
  printf "\r\033[K"
  echo "  Installation Failed, here's why:"
  echo ""
  tail -30 "$LOG" | sed 's/^/    /'
  echo ""
  echo "  (failed at step $1: $2 — full log: $LOG)"
  echo ""; echo "  Press Enter to close."; read _
  exit 1
}
step() {  # $1 num, $2 label, rest = command (run quietly with a live spinner)
  local n=$1 label="$2"; shift 2
  ( "$@" >>"$LOG" 2>&1 ) & local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null; do draw $((n-1)) "$label" "${SPIN:i++%${#SPIN}:1}"; sleep 0.15; done
  if ! wait "$pid"; then fail "$n" "$label"; fi
  draw "$n" "$label"
}

clear 2>/dev/null
echo ""
echo "  Installing $APP_NAME"
echo "  into $DEST"
echo ""
draw 0 "starting..."
xattr -dr com.apple.quarantine "$PKG_DIR" 2>/dev/null || true
mkdir -p "$DEST"

do_copy() {  # everything except the big runtime tarball (unpacked separately)
  rsync -a --exclude 'env.tar.gz' "$SRC/" "$DEST/" || return 1
  chmod +x "$DEST/run_app.command" 2>/dev/null
  return 0
}
do_runtime() {  # unpack the conda-packed runtime + relocate it in place
  [ -x "$ENV/bin/python" ] && return 0
  mkdir -p "$ENV" || return 1
  tar -xzf "$SRC/env.tar.gz" -C "$ENV" || return 1
  "$ENV/bin/conda-unpack" || return 1
}
do_launcher() {
  local DESKTOP_CMD="$HOME/Desktop/$APP_NAME.command"
  printf '#!/bin/bash\nexec "%s/run_app.command"\n' "$DEST" > "$DESKTOP_CMD" || return 1
  chmod +x "$DESKTOP_CMD"
  xattr -dr com.apple.quarantine "$DESKTOP_CMD" 2>/dev/null || true
  if [ -f "$DEST/vf_logo.png" ] && command -v Rez >/dev/null 2>&1 && command -v SetFile >/dev/null 2>&1; then
    cp "$DEST/vf_logo.png" /tmp/_vficon.png
    sips -i /tmp/_vficon.png >/dev/null 2>&1
    DeRez -only icns /tmp/_vficon.png > /tmp/_vficon.rsrc 2>/dev/null
    Rez -append /tmp/_vficon.rsrc -o "$DESKTOP_CMD" 2>/dev/null
    SetFile -a C "$DESKTOP_CMD" 2>/dev/null
    rm -f /tmp/_vficon.png /tmp/_vficon.rsrc
  fi
  return 0
}

step 1 "Copying app files"     do_copy
step 2 "Unpacking runtime"     do_runtime
step 3 "Creating Desktop icon" do_launcher

printf "\r\033[K"
echo "  [######################] $TOTAL/$TOTAL  done"
echo ""
echo "  $APP_NAME has been installed! Exit this window and open your app through the desktop icon."
echo "  (Install log saved to your Desktop: $(basename "$LOG"))"
echo ""
read _
"""

INSTALL_BAT = r"""@echo off
setlocal enabledelayedexpansion
REM Installer for __APP_NAME__ (Windows x64). Run once. FULLY OFFLINE.
REM
REM Unpacks a self-contained runtime (Python + Node + Git + codex + the app) into
REM %USERPROFILE%\Documents\VibeFoundryApplications\__SLUG__\ and relocates it with
REM conda-unpack. Nothing is downloaded; nothing touches the system PATH or registry.
REM The path is SPACE-FREE (conda-pack relocation refuses prefixes with spaces).
set "PKG_DIR=%~dp0"
set "SRC=%PKG_DIR%application_core"
set "APP_NAME=__APP_NAME__"
set "SLUG=__SLUG__"
set "DEST=%USERPROFILE%\Documents\VibeFoundryApplications\%SLUG%"
set "ENV=%DEST%\env"

REM Write the install log to the Desktop (always there afterward). Detect the
REM real Desktop via PowerShell so OneDrive-redirected desktops work too.
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%d"
if not defined DESKTOP set "DESKTOP=%USERPROFILE%\Desktop"
set "LOG=%DESKTOP%\%APP_NAME%_install_log.txt"
type nul > "%LOG%"

cls
echo.
echo   Installing %APP_NAME%
echo   into %DEST%
echo.

REM All chatty output goes to %LOG%; the screen shows block-by-block progress.
echo   [#######...............] 1/3  Copying app files
if not exist "%DEST%" mkdir "%DEST%"
REM Copy everything except the big runtime tarball (unpacked separately below).
robocopy "%SRC%" "%DEST%" /E /XF env.tar.gz >> "%LOG%" 2>&1
REM robocopy exit codes < 8 mean success (files copied / nothing to do).
if errorlevel 8 goto :failed

echo   [###############.......] 2/3  Unpacking runtime
if not exist "%ENV%" mkdir "%ENV%"
tar -xzf "%SRC%\env.tar.gz" -C "%ENV%" >> "%LOG%" 2>&1
if errorlevel 1 goto :failed
call "%ENV%\Scripts\conda-unpack.exe" >> "%LOG%" 2>&1
if errorlevel 1 goto :failed

echo   [######################] 3/3  Creating Desktop icon
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'%APP_NAME%.lnk')); $s.TargetPath='%DEST%\run_app.bat'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\%SLUG%.ico'; $s.WindowStyle=1; $s.Save()" >> "%LOG%" 2>&1

echo.
echo   %APP_NAME% has been installed! Exit this window and open your app through the desktop icon.
echo   (Install log saved to your Desktop: %APP_NAME%_install_log.txt)
echo.
pause
exit /b 0

:failed
echo.
echo   Installation Failed, here's why:
echo.
powershell -NoProfile -Command "Get-Content -Tail 30 -LiteralPath '%LOG%' | ForEach-Object { '    ' + $_ }"
echo.
echo   (full log: %LOG%)
echo.
pause
exit /b 1
"""


def emit_scripts(package: Path, core: Path, app_name: str, slug: str) -> None:
    """Write run_app + install for the HOST OS only (the package is OS-specific)."""
    def w(path: Path, template: str, executable: bool = False) -> None:
        text = _fill(template, app_name, slug)
        path.write_text(text, encoding="utf-8")
        if executable:
            os.chmod(path, 0o755)

    w(core / "splash.html", SPLASH_HTML)
    if WIN:
        w(core / "run_app.bat", RUN_APP_BAT)
        w(package / "install.bat", INSTALL_BAT)
    else:
        w(core / "run_app.command", RUN_APP_COMMAND, executable=True)
        w(package / "install.command", INSTALL_COMMAND, executable=True)


# --- orchestration ------------------------------------------------------------

def main() -> None:
    app_name = " ".join(sys.argv[1:]).strip()
    if not app_name:
        app_name = input("App name: ").strip()
    if not app_name:
        print("An app name is required.")
        sys.exit(1)
    slug = slugify(app_name)

    package = next_version_dir(PUBLISHED_DIR, f"{slug}_{OS_TAG}")
    core = package / "application_core"
    banner(f"Publishing '{app_name}' for {OS_TAG}  ->  {package}")

    banner("[1/5] Build frontend (npm ci + vite build)")
    core.mkdir(parents=True, exist_ok=True)
    build_frontend(core, app_name)

    banner("[2/5] Build + pack runtime (conda env + codex)")
    build_runtime(package, core)

    banner("[3/5] Assemble application_core")
    assemble(core)

    banner("[4/5] Generate icons")
    make_icons(core, slug)

    banner("[5/5] Emit installer + launcher")
    emit_scripts(package, core, app_name, slug)

    banner("Done")
    print(f"Package: {package}")
    if WIN:
        print("Hand the whole folder to a Windows user; they run install.bat once,")
    else:
        print("Hand the whole folder to a macOS user; they run install.command once,")
    print("then launch from the Desktop icon. The install downloads nothing.")
    print("")
    print(f"NOTE: this package runs on {OS_TAG} only. To make the other OS's package,")
    print("run this same script on that OS (conda-pack cannot cross-build).")


if __name__ == "__main__":
    main()
