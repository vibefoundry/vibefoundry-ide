"""
File watching for data and script changes
"""

import asyncio
from pathlib import Path
from typing import Callable, Optional
from dataclasses import dataclass, field


@dataclass
class FileState:
    """Tracks file modification times"""
    input_files: dict[str, float] = field(default_factory=dict)
    output_files: dict[str, float] = field(default_factory=dict)
    script_files: dict[str, float] = field(default_factory=dict)


@dataclass
class FileChange:
    """Represents a file change event"""
    path: str
    change_type: str  # "created", "modified", "deleted"
    folder_type: str  # "input", "output", "scripts"


class FileWatcher:
    """
    Watches project folders for file changes.
    """

    def __init__(
        self,
        project_folder: Path,
        on_data_change: Optional[Callable[[], None]] = None,
        on_script_change: Optional[Callable[[Path], None]] = None,
        on_output_file_change: Optional[Callable[[Path, str], None]] = None,  # (path, change_type)
        poll_interval: float = 1.0
    ):
        self.project_folder = project_folder
        self.input_folder = project_folder / "input_folder"
        self.output_folder = project_folder / "output_folder"
        self.scripts_folder = project_folder / "app_folder" / "scripts"

        self.on_data_change = on_data_change
        self.on_script_change = on_script_change
        self.on_output_file_change = on_output_file_change
        self.poll_interval = poll_interval

        self.state = FileState()
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def _scan_folder(self, folder: Path) -> dict[str, float]:
        """Scan a folder and return file modification times"""
        result = {}
        if folder.exists():
            for f in folder.glob("**/*"):
                if f.is_file():
                    try:
                        result[str(f)] = f.stat().st_mtime
                    except (OSError, FileNotFoundError):
                        pass
        return result

    def _detect_changes(
        self,
        old_state: dict[str, float],
        new_state: dict[str, float],
        folder_type: str
    ) -> list[FileChange]:
        """Detect changes between two file states"""
        changes = []

        # Check for new/modified files
        for path, mtime in new_state.items():
            if path not in old_state:
                changes.append(FileChange(path, "created", folder_type))
            elif old_state[path] != mtime:
                changes.append(FileChange(path, "modified", folder_type))

        # Check for deleted files
        for path in old_state:
            if path not in new_state:
                changes.append(FileChange(path, "deleted", folder_type))

        return changes

    def scan_initial_state(self):
        """Perform initial scan of all folders"""
        self.state.input_files = self._scan_folder(self.input_folder)
        self.state.output_files = self._scan_folder(self.output_folder)
        self.state.script_files = self._scan_folder(self.scripts_folder)

    async def _watch_loop(self):
        """Main watch loop"""
        while self._running:
            try:
                # Scan current state
                new_input = self._scan_folder(self.input_folder)
                new_output = self._scan_folder(self.output_folder)
                new_scripts = self._scan_folder(self.scripts_folder)

                # Detect changes
                input_changes = self._detect_changes(
                    self.state.input_files, new_input, "input"
                )
                output_changes = self._detect_changes(
                    self.state.output_files, new_output, "output"
                )
                script_changes = self._detect_changes(
                    self.state.script_files, new_scripts, "scripts"
                )

                # Update state
                self.state.input_files = new_input
                self.state.output_files = new_output
                self.state.script_files = new_scripts

                # Trigger callbacks
                if (input_changes or output_changes) and self.on_data_change:
                    self.on_data_change()

                # Notify about output file changes for auto-preview
                if output_changes and self.on_output_file_change:
                    for change in output_changes:
                        if change.change_type in ("created", "modified"):
                            self.on_output_file_change(Path(change.path), change.change_type)

                if script_changes and self.on_script_change:
                    for change in script_changes:
                        if change.change_type in ("created", "modified"):
                            self.on_script_change(Path(change.path))

            except Exception as e:
                print(f"Watch error: {e}")

            await asyncio.sleep(self.poll_interval)

    def start(self):
        """Start watching (non-async entry point)"""
        self._running = True
        self.scan_initial_state()

    async def start_async(self):
        """Start watching asynchronously"""
        self._running = True
        self.scan_initial_state()
        self._task = asyncio.create_task(self._watch_loop())

    def stop(self):
        """Stop watching"""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    def check_once(self) -> tuple[list[FileChange], list[FileChange], list[FileChange]]:
        """
        Perform a single check for changes.
        Returns (input_changes, output_changes, script_changes)
        """
        new_input = self._scan_folder(self.input_folder)
        new_output = self._scan_folder(self.output_folder)
        new_scripts = self._scan_folder(self.scripts_folder)

        input_changes = self._detect_changes(
            self.state.input_files, new_input, "input"
        )
        output_changes = self._detect_changes(
            self.state.output_files, new_output, "output"
        )
        script_changes = self._detect_changes(
            self.state.script_files, new_scripts, "scripts"
        )

        self.state.input_files = new_input
        self.state.output_files = new_output
        self.state.script_files = new_scripts

        return input_changes, output_changes, script_changes
