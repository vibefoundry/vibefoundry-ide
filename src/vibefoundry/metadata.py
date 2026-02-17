"""
Metadata generation for input/output data files
"""

from pathlib import Path
from datetime import datetime
from typing import Optional
import os

# Cache: {filepath: (mtime, row_count, columns)}
_metadata_cache: dict[str, tuple[float, int, list[str]]] = {}


def count_csv_rows_fast(filepath: Path) -> int:
    """Count CSV rows without loading into memory - just count newlines."""
    count = 0
    with open(filepath, 'rb') as f:
        # Read in chunks for memory efficiency
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            count += chunk.count(b'\n')
    return max(0, count - 1)  # Subtract header row


def get_csv_columns_fast(filepath: Path) -> list[str]:
    """Get CSV column names by reading just the first line."""
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        header = f.readline().strip()
    # Handle quoted columns
    if ',' in header:
        import csv
        from io import StringIO
        reader = csv.reader(StringIO(header))
        return next(reader, [])
    return header.split(',')


def scan_folder_metadata(folder: Path, title: str) -> str:
    """
    Scan a folder and generate metadata text describing data files.
    Uses caching and fast row counting to avoid loading files into memory.

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
            mtime = filepath.stat().st_mtime
            cache_key = str(filepath)

            # Check cache - use cached values if file hasn't changed
            if cache_key in _metadata_cache:
                cached_mtime, cached_rows, cached_cols = _metadata_cache[cache_key]
                if cached_mtime == mtime:
                    row_count = cached_rows
                    columns = cached_cols
                else:
                    row_count, columns = None, None
            else:
                row_count, columns = None, None

            # If not cached or stale, read file metadata efficiently
            if row_count is None:
                if filepath.suffix == '.csv':
                    # Fast: count newlines, don't parse
                    row_count = count_csv_rows_fast(filepath)
                    columns = get_csv_columns_fast(filepath)
                elif filepath.suffix in ['.xlsx', '.xls']:
                    # Excel - use openpyxl for row count, Polars for columns
                    try:
                        from openpyxl import load_workbook
                        wb = load_workbook(filepath, read_only=True)
                        ws = wb.active
                        row_count = ws.max_row - 1  # Subtract header
                        # Get columns from first row
                        columns = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
                        columns = [str(c) if c is not None else '' for c in columns]
                        wb.close()
                    except:
                        # Fallback: use Polars to read Excel
                        import polars as pl
                        df = pl.read_excel(filepath)
                        row_count = len(df)
                        columns = df.columns
                elif filepath.suffix == '.parquet':
                    # Parquet - Polars can scan metadata without loading
                    import polars as pl
                    try:
                        lf = pl.scan_parquet(filepath)
                        columns = lf.collect_schema().names()
                        row_count = lf.select(pl.len()).collect().item()
                    except:
                        # Fallback: eager load
                        df = pl.read_parquet(filepath)
                        row_count = len(df)
                        columns = df.columns
                else:
                    continue

                # Update cache
                _metadata_cache[cache_key] = (mtime, row_count, columns)

            rel_path = filepath.relative_to(folder)
            lines.append(f"File: {rel_path}")
            lines.append(f"  Absolute Path: {filepath}")
            lines.append(f"  Size: {size_mb:.2f} MB")
            lines.append(f"  Rows: {row_count}")
            lines.append(f"  Columns ({len(columns)}):")

            for col in columns:
                lines.append(f"    - {col}")

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

    input_meta = None
    output_meta = None

    # Only generate metadata if app_folder structure exists (user clicked Build)
    if not meta_folder.parent.exists():
        return input_meta, output_meta

    # Ensure meta folder exists within app_folder
    meta_folder.mkdir(parents=True, exist_ok=True)

    if input_folder.exists():
        input_meta = scan_folder_metadata(input_folder, "Input Folder")
        (meta_folder / "input_metadata.txt").write_text(input_meta)

    if output_folder.exists():
        output_meta = scan_folder_metadata(output_folder, "Output Folder")
        (meta_folder / "output_metadata.txt").write_text(output_meta)

    return input_meta, output_meta
