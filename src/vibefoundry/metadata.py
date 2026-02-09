"""
Metadata generation for input/output data files
"""

from pathlib import Path
from datetime import datetime
from typing import Optional

import pandas as pd


def scan_folder_metadata(folder: Path, title: str) -> str:
    """
    Scan a folder and generate metadata text describing data files.

    Args:
        folder: Path to scan
        title: Title for the metadata section

    Returns:
        Formatted metadata string
    """
    lines = [
        f"{title} Metadata",
        f"Folder: {folder}",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 50,
        ""
    ]

    data_extensions = ['.csv', '.xlsx', '.xls', '.parquet']
    data_files = []
    for ext in data_extensions:
        data_files.extend(folder.glob(f"**/*{ext}"))

    if not data_files:
        lines.append("No data files found.")
        return "\n".join(lines)

    for filepath in sorted(data_files):
        try:
            size_mb = filepath.stat().st_size / (1024 * 1024)

            if filepath.suffix == '.csv':
                df = pd.read_csv(filepath, nrows=0)
                df_full = pd.read_csv(filepath)
                row_count = len(df_full)
            elif filepath.suffix in ['.xlsx', '.xls']:
                df = pd.read_excel(filepath, nrows=0)
                df_full = pd.read_excel(filepath)
                row_count = len(df_full)
            elif filepath.suffix == '.parquet':
                df = pd.read_parquet(filepath)
                row_count = len(df)
            else:
                continue

            rel_path = filepath.relative_to(folder)
            lines.append(f"File: {rel_path}")
            lines.append(f"  Absolute Path: {filepath}")
            lines.append(f"  Size: {size_mb:.2f} MB")
            lines.append(f"  Rows: {row_count}")
            lines.append(f"  Columns ({len(df.columns)}):")

            for col in df.columns:
                dtype = str(df[col].dtype) if col in df.columns else "unknown"
                lines.append(f"    - {col} ({dtype})")

            lines.append("")

        except Exception as e:
            lines.append(f"File: {filepath.name}")
            lines.append(f"  Error reading: {e}")
            lines.append("")

    return "\n".join(lines)


def generate_metadata(project_folder: Path) -> tuple[Optional[str], Optional[str]]:
    """
    Generate metadata files for input and output folders.

    Args:
        project_folder: Root project folder

    Returns:
        Tuple of (input_metadata, output_metadata) strings, or None if folder doesn't exist
    """
    input_folder = project_folder / "input_folder"
    output_folder = project_folder / "output_folder"
    meta_folder = project_folder / "app_folder" / "meta_data"

    # Ensure meta folder exists
    meta_folder.mkdir(parents=True, exist_ok=True)

    input_meta = None
    output_meta = None

    if input_folder.exists():
        input_meta = scan_folder_metadata(input_folder, "Input Folder")
        (meta_folder / "input_metadata.txt").write_text(input_meta)

    if output_folder.exists():
        output_meta = scan_folder_metadata(output_folder, "Output Folder")
        (meta_folder / "output_metadata.txt").write_text(output_meta)

    return input_meta, output_meta
