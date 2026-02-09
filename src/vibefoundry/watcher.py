"""
File watching for data and script changes.
Uses watchdog (native OS events) when available, falls back to polling.
"""

import asyncio
import threading
import time
from pathlib import Path
from typing import Callable, Optional
from dataclasses import dataclass, field

# Try to import watchdog, fall back to polling if not available
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    Observer = None
    FileSystemEventHandler = object
    FileSystemEvent = None


@dataclass
class FileState:
    """Tracks file modification times for polling mode"""
    input_files: dict[str, float] = field(default_factory=dict)
    output_files: dict[str, float] = field(default_factory=dict)
    script_files: dict[str, float] = field(default_factory=dict)


@dataclass
class FileChange:
    """Represents a file change event"""
    path: str
    change_type: str  # "created", "modified", "deleted"
    folder_type: str  # "input", "output", "scripts"


# Ignore patterns for both watchdog and polling
IGNORE_PATTERNS = [
    '.ds_store', 'thumbs.db', 'desktop.ini',
    '.git', '__pycache__', '.pyc', '.pyo',
    'zone.identifier', '.tmp', '.temp', '~',
    'time_keeper.txt', 'time_keeper'
]


def should_ignore(path: str) -> bool:
    """Check if this file should be ignored"""
    name = Path(path).name.lower()
    for pattern in IGNORE_PATTERNS:
        if pattern in name:
            return True
    if name.startswith('.'):
        return True
    return False


class FolderHandler(FileSystemEventHandler):
    """Handler for watchdog file system events"""

    def __init__(self, folder_type: str, on_change: Optional[Callable[[FileChange], None]] = None):
        self.folder_type = folder_type
        self.on_change = on_change
        self._recent_events: dict[str, float] = {}
        self._lock = threading.Lock()

    def _handle_event(self, event, change_type: str):
        if event.is_directory:
            return
        path = event.src_path
        if should_ignore(path):
            return

        # Debounce
        now = time.time()
        with self._lock:
            if now - self._recent_events.get(path, 0) < 0.5:
                return
            self._recent_events[path] = now
            self._recent_events = {k: v for k, v in self._recent_events.items() if now - v < 5.0}

        if self.on_change:
            self.on_change(FileChange(path=path, change_type=change_type, folder_type=self.folder_type))

    def on_created(self, event):
        self._handle_event(event, "created")

    def on_modified(self, event):
        self._handle_event(event, "modified")

    def on_deleted(self, event):
        self._handle_event(event, "deleted")


class FileWatcher:
    """
    Watches project folders for file changes.
    Uses watchdog when available and working, falls back to polling.
    """

    def __init__(
        self,
        project_folder: Path,
        on_data_change: Optional[Callable[[], None]] = None,
        on_script_change: Optional[Callable[[Path], None]] = None,
        on_output_file_change: Optional[Callable[[Path, str], None]] = None,
        poll_interval: float = 2.0
    ):
        self.project_folder = project_folder
        self.input_folder = project_folder / "input_folder"
        self.output_folder = project_folder / "output_folder"
        self.scripts_folder = project_folder / "app_folder" / "scripts"

        self.on_data_change = on_data_change
        self.on_script_change = on_script_change
        self.on_output_file_change = on_output_file_change
        self.poll_interval = poll_interval

        self._observer = None
        self._running = False
        self._loop = None
        self._task = None
        self._use_polling = False
        self.state = FileState()

    def _safe_callback(self, callback, *args):
        """Safely call a callback from watchdog thread"""
        if callback is None:
            return
        try:
            result = callback(*args)
            if asyncio.iscoroutine(result) and self._loop:
                asyncio.run_coroutine_threadsafe(result, self._loop)
        except Exception as e:
            print(f"Watcher callback error: {e}")

    def _handle_change(self, change: FileChange):
        """Route change events to callbacks"""
        print(f"[Watcher] {change.change_type} in {change.folder_type}: {change.path}")
        if change.folder_type == "input":
            self._safe_callback(self.on_data_change)
        elif change.folder_type == "output":
            self._safe_callback(self.on_data_change)
            if change.change_type in ("created", "modified"):
                self._safe_callback(self.on_output_file_change, Path(change.path), change.change_type)
        elif change.folder_type == "scripts":
            if change.change_type in ("created", "modified"):
                self._safe_callback(self.on_script_change, Path(change.path))

    def _scan_folder(self, folder: Path) -> dict[str, float]:
        """Scan folder for polling mode"""
        result = {}
        if folder.exists():
            for f in folder.glob("**/*"):
                if f.is_file() and not should_ignore(str(f)):
                    try:
                        result[str(f)] = f.stat().st_mtime
                    except (OSError, FileNotFoundError):
                        pass
        return result

    def _detect_changes(self, old: dict, new: dict, folder_type: str) -> list[FileChange]:
        """Detect changes for polling mode"""
        changes = []
        for path, mtime in new.items():
            if path not in old:
                changes.append(FileChange(path, "created", folder_type))
            elif old[path] != mtime:
                changes.append(FileChange(path, "modified", folder_type))
        for path in old:
            if path not in new:
                changes.append(FileChange(path, "deleted", folder_type))
        return changes

    def scan_initial_state(self):
        """Initial scan for polling mode"""
        if self._use_polling:
            self.state.input_files = self._scan_folder(self.input_folder)
            self.state.output_files = self._scan_folder(self.output_folder)
            self.state.script_files = self._scan_folder(self.scripts_folder)

    async def _poll_loop(self):
        """Polling loop fallback"""
        while self._running:
            try:
                new_input = self._scan_folder(self.input_folder)
                new_output = self._scan_folder(self.output_folder)
                new_scripts = self._scan_folder(self.scripts_folder)

                for change in self._detect_changes(self.state.input_files, new_input, "input"):
                    self._handle_change(change)
                for change in self._detect_changes(self.state.output_files, new_output, "output"):
                    self._handle_change(change)
                for change in self._detect_changes(self.state.script_files, new_scripts, "scripts"):
                    self._handle_change(change)

                self.state.input_files = new_input
                self.state.output_files = new_output
                self.state.script_files = new_scripts
            except Exception as e:
                print(f"Poll error: {e}")

            await asyncio.sleep(self.poll_interval)

    def _try_start_watchdog(self) -> bool:
        """Try to start watchdog, return True if successful"""
        if not WATCHDOG_AVAILABLE:
            return False

        try:
            self._observer = Observer()

            for folder, folder_type in [
                (self.input_folder, "input"),
                (self.output_folder, "output"),
                (self.scripts_folder, "scripts")
            ]:
                folder.mkdir(parents=True, exist_ok=True)
                handler = FolderHandler(folder_type, self._handle_change)
                self._observer.schedule(handler, str(folder), recursive=True)

            self._observer.start()

            # Quick test - if it started, give it a moment to fail if it's going to
            time.sleep(0.1)
            if not self._observer.is_alive():
                return False

            return True
        except Exception as e:
            print(f"Watchdog failed, using polling: {e}")
            if self._observer:
                try:
                    self._observer.stop()
                except:
                    pass
                self._observer = None
            return False

    def start(self, loop: Optional[asyncio.AbstractEventLoop] = None):
        """Start watching"""
        if self._running:
            return

        self._running = True
        self._loop = loop

        # Ensure folders exist
        self.input_folder.mkdir(parents=True, exist_ok=True)
        self.output_folder.mkdir(parents=True, exist_ok=True)
        self.scripts_folder.mkdir(parents=True, exist_ok=True)

        # Try watchdog first
        if self._try_start_watchdog():
            self._use_polling = False
            print("File watcher: using native OS events")
        else:
            self._use_polling = True
            self.scan_initial_state()
            print("File watcher: using polling")

    async def start_async(self):
        """Start watching with async support"""
        loop = asyncio.get_running_loop()
        self.start(loop=loop)

        # Start polling loop if needed
        if self._use_polling:
            self._task = asyncio.create_task(self._poll_loop())

    def stop(self):
        """Stop watching"""
        self._running = False
        if self._observer:
            try:
                self._observer.stop()
                self._observer.join(timeout=1.0)
            except:
                pass
            self._observer = None
        if self._task:
            self._task.cancel()
            self._task = None

    def check_once(self):
        """For compatibility - returns empty lists"""
        return [], [], []
