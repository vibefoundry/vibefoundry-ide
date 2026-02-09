"""
Browser launcher for Chrome/Edge app-mode
"""

import os
import sys
import subprocess
import shutil
import webbrowser


def find_chrome_path() -> str | None:
    """Find Chrome/Edge/Chromium executable path"""
    if sys.platform == "darwin":  # macOS
        paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for path in paths:
            if os.path.exists(path):
                return path

    elif sys.platform == "win32":  # Windows
        # Try common locations
        chrome = shutil.which("chrome") or shutil.which("google-chrome")
        if chrome:
            return chrome

        edge = shutil.which("msedge")
        if edge:
            return edge

        # Check Program Files
        program_files = [
            os.environ.get("ProgramFiles", "C:\\Program Files"),
            os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"),
            os.environ.get("LocalAppData", ""),
        ]
        chrome_paths = [
            "Google\\Chrome\\Application\\chrome.exe",
            "Microsoft\\Edge\\Application\\msedge.exe",
        ]
        for pf in program_files:
            if pf:
                for cp in chrome_paths:
                    full_path = os.path.join(pf, cp)
                    if os.path.exists(full_path):
                        return full_path

    else:  # Linux
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]:
            path = shutil.which(name)
            if path:
                return path

    return None


def launch_app_mode(url: str) -> bool:
    """
    Launch browser in app mode (no URL bar).
    Returns True if launched in app mode, False if fell back to regular browser.
    """
    chrome_path = find_chrome_path()

    if chrome_path:
        try:
            subprocess.Popen([chrome_path, f"--app={url}"])
            return True
        except Exception:
            pass

    # Fallback to regular browser
    webbrowser.open(url)
    return False
