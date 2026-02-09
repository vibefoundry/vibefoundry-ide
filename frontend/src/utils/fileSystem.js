import Papa from 'papaparse'
import * as XLSX from 'xlsx'

const DISPLAY_ROWS = 1000

// Data files that should never exist in app_folder (auto-deleted for safety)
const FORBIDDEN_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json']
const MAX_TXT_SIZE_BYTES = 50 * 1024 // 50KB

/**
 * Get file type category based on extension
 */
export function getFileType(filename) {
  const ext = '.' + filename.split('.').pop().toLowerCase()

  if (['.csv', '.xlsx', '.xls'].includes(ext)) return 'dataframe'
  if (ext === '.json') return 'json'
  if (['.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.sql', '.sh', '.yaml', '.yml'].includes(ext)) return 'code'
  if (ext === '.md') return 'markdown'
  if (['.txt', '.log'].includes(ext)) return 'text'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'].includes(ext)) return 'image'
  if (['.parquet'].includes(ext)) return 'unsupported'

  return 'text'
}

/**
 * Get file extension
 */
export function getExtension(filename) {
  return '.' + filename.split('.').pop().toLowerCase()
}

/**
 * Read CSV or Excel file as dataframe (first 1000 rows only)
 */
async function readDataFrame(file, extension, filename) {
  if (extension === '.csv') {
    // Stream CSV and stop after first 1000 rows
    return new Promise((resolve) => {
      const data = []
      let columns = []

      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        step: (row, parser) => {
          if (columns.length === 0) {
            columns = Object.keys(row.data)
          }
          data.push(row.data)
          if (data.length >= DISPLAY_ROWS) {
            parser.abort()
          }
        },
        complete: () => {
          resolve({
            type: 'dataframe',
            filename,
            columns,
            data,
            totalRows: data.length,
            limited: data.length >= DISPLAY_ROWS
          })
        }
      })
    })
  } else if (['.xlsx', '.xls'].includes(extension)) {
    const buffer = await file.arrayBuffer()
    // Only parse first 1001 rows (1 header + 1000 data)
    const workbook = XLSX.read(buffer, { type: 'array', sheetRows: DISPLAY_ROWS + 1 })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    if (jsonData.length === 0) {
      return {
        type: 'dataframe',
        filename,
        columns: [],
        data: [],
        totalRows: 0,
        limited: false
      }
    }

    const columns = jsonData[0]
    const rows = jsonData.slice(1).map(row => {
      const obj = {}
      columns.forEach((col, i) => {
        obj[col] = row[i] ?? ''
      })
      return obj
    })

    return {
      type: 'dataframe',
      filename,
      columns,
      data: rows,
      totalRows: rows.length,
      limited: rows.length >= DISPLAY_ROWS
    }
  }
}

/**
 * Read JSON file
 */
async function readJSON(file, filename) {
  const text = await file.text()
  const data = JSON.parse(text)

  return {
    type: 'json',
    filename,
    data
  }
}

/**
 * Read text/code/markdown file
 */
async function readText(file, filename, extension, fileType) {
  const text = await file.text()

  return {
    type: fileType,
    filename,
    extension,
    content: text
  }
}

/**
 * Check if a file should be auto-deleted from app_folder
 * Deletes: CSV, XLSX, XLS, JSON, and TXT files > 50KB
 */
async function shouldDeleteFile(fileHandle) {
  const ext = getExtension(fileHandle.name)

  // Always delete data files
  if (FORBIDDEN_EXTENSIONS.includes(ext)) {
    return true
  }

  // Delete large txt files
  if (ext === '.txt') {
    try {
      const file = await fileHandle.getFile()
      if (file.size > MAX_TXT_SIZE_BYTES) {
        return true
      }
    } catch (e) {
      // If we can't read the file, don't delete it
    }
  }

  return false
}

/**
 * Clean app_folder by removing data files (CSV, XLSX, JSON) and large TXT files
 * This ensures no sensitive data accidentally ends up in the synced folder
 */
export async function cleanAppFolder(dirHandle) {
  const deleted = []

  async function cleanRecursively(currentDirHandle, currentPath) {
    const toDelete = []

    for await (const [name, handle] of currentDirHandle.entries()) {
      if (handle.kind === 'directory') {
        // Recurse into subdirectories
        await cleanRecursively(handle, `${currentPath}/${name}`)
      } else {
        // Check if file should be deleted
        if (await shouldDeleteFile(handle)) {
          toDelete.push(name)
        }
      }
    }

    // Delete flagged files
    for (const name of toDelete) {
      try {
        await currentDirHandle.removeEntry(name)
        deleted.push(`${currentPath}/${name}`)
        console.log(`[Safety] Auto-deleted: ${currentPath}/${name}`)
      } catch (e) {
        console.error(`[Safety] Failed to delete ${currentPath}/${name}:`, e)
      }
    }
  }

  await cleanRecursively(dirHandle, dirHandle.name)
  return deleted
}

/**
 * Build file tree recursively from FileSystemDirectoryHandle (File System Access API)
 * Returns { node, deletedFiles } where deletedFiles is an array of deleted file names
 */
export async function buildFileTreeFromHandle(dirHandle, path = '', isAppFolder = false, deletedFiles = []) {
  const currentPath = path ? `${path}/${dirHandle.name}` : dirHandle.name

  const node = {
    name: dirHandle.name,
    path: currentPath,
    isDirectory: true,
    handle: dirHandle,
    children: []
  }

  const entries = []
  // Skip certain folders that shouldn't be polled
  const SKIP_FOLDERS = ['node_modules', '.git', '__pycache__', '.next', 'dist', 'build', '.cache']

  for await (const [name, handle] of dirHandle.entries()) {
    // Skip large/irrelevant folders
    if (handle.kind === 'directory' && SKIP_FOLDERS.includes(name)) {
      continue
    }

    // Auto-delete forbidden files in app_folder
    if (isAppFolder && handle.kind === 'file') {
      if (await shouldDeleteFile(handle)) {
        try {
          await dirHandle.removeEntry(name)
          deletedFiles.push(name)
          console.log(`[Safety] Auto-deleted: ${currentPath}/${name}`)
        } catch (e) {
          console.error(`[Safety] Failed to delete ${currentPath}/${name}:`, e)
          // Still add to deletedFiles for toast even if delete failed
          deletedFiles.push(name)
        }
        // NEVER add forbidden files to tree, even if delete fails
        continue
      }
    }

    entries.push({ name, handle })
  }

  // Sort: folders first, then files, alphabetically
  entries.sort((a, b) => {
    const aIsDir = a.handle.kind === 'directory'
    const bIsDir = b.handle.kind === 'directory'
    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  for (const { name, handle } of entries) {
    if (handle.kind === 'directory') {
      // Detect if we're entering app_folder
      const enteringAppFolder = isAppFolder || name === 'app_folder'
      const { node: childNode } = await buildFileTreeFromHandle(handle, currentPath, enteringAppFolder, deletedFiles)
      node.children.push(childNode)
    } else {
      // File handle
      let lastModified = null
      try {
        const file = await handle.getFile()
        lastModified = file.lastModified
      } catch (e) {
        // Ignore errors getting metadata
      }

      node.children.push({
        name: handle.name,
        path: `${currentPath}/${handle.name}`,
        isDirectory: false,
        handle: handle,
        extension: getExtension(handle.name),
        fileType: getFileType(handle.name),
        lastModified
      })
    }
  }

  return { node, deletedFiles }
}

/**
 * Read file content from FileSystemFileHandle (File System Access API)
 */
export async function readFileFromHandle(fileHandle) {
  const file = await fileHandle.getFile()
  const filename = file.name
  const extension = getExtension(filename)
  const fileType = getFileType(filename)

  try {
    if (fileType === 'dataframe') {
      return await readDataFrame(file, extension, filename)
    } else if (fileType === 'json') {
      return await readJSON(file, filename)
    } else if (fileType === 'code' || fileType === 'markdown' || fileType === 'text') {
      return await readText(file, filename, extension, fileType)
    } else if (fileType === 'unsupported') {
      return {
        type: 'unknown',
        filename,
        message: `Cannot preview ${extension} files in browser`
      }
    }
  } catch (err) {
    return {
      type: 'error',
      filename,
      message: err.message
    }
  }
}

/**
 * Write content to a file using FileSystemFileHandle
 */
export async function writeFileToHandle(fileHandle, content) {
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * Export data to a new file using showSaveFilePicker
 */
export async function exportToFile(data, suggestedName, types) {
  try {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName,
      types
    })
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
    return true
  } catch (err) {
    if (err.name === 'AbortError') {
      return false // User cancelled
    }
    throw err
  }
}

// ============================================
// File Management Operations
// ============================================

/**
 * Create a new folder inside a directory
 */
export async function createFolder(parentDirHandle, folderName) {
  return await parentDirHandle.getDirectoryHandle(folderName, { create: true })
}

/**
 * Create a new file inside a directory
 */
export async function createFile(parentDirHandle, fileName, content = '') {
  const fileHandle = await parentDirHandle.getFileHandle(fileName, { create: true })
  if (content) {
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }
  return fileHandle
}

/**
 * Delete a file or folder
 */
export async function deleteEntry(parentDirHandle, entryName, isDirectory = false) {
  await parentDirHandle.removeEntry(entryName, { recursive: isDirectory })
}

/**
 * Rename a file or folder (copy to new name, delete old)
 */
export async function renameEntry(parentDirHandle, oldName, newName, isDirectory = false) {
  if (isDirectory) {
    // For directories, we need to copy contents recursively
    const oldDirHandle = await parentDirHandle.getDirectoryHandle(oldName)
    const newDirHandle = await parentDirHandle.getDirectoryHandle(newName, { create: true })
    await copyDirectoryContents(oldDirHandle, newDirHandle)
    await parentDirHandle.removeEntry(oldName, { recursive: true })
    return newDirHandle
  } else {
    // For files, read content, create new, delete old
    const oldFileHandle = await parentDirHandle.getFileHandle(oldName)
    const file = await oldFileHandle.getFile()
    const content = await file.arrayBuffer()

    const newFileHandle = await parentDirHandle.getFileHandle(newName, { create: true })
    const writable = await newFileHandle.createWritable()
    await writable.write(content)
    await writable.close()

    await parentDirHandle.removeEntry(oldName)
    return newFileHandle
  }
}

/**
 * Copy directory contents recursively
 */
async function copyDirectoryContents(srcDirHandle, destDirHandle) {
  for await (const [name, handle] of srcDirHandle.entries()) {
    if (handle.kind === 'directory') {
      const newSubDir = await destDirHandle.getDirectoryHandle(name, { create: true })
      await copyDirectoryContents(handle, newSubDir)
    } else {
      const file = await handle.getFile()
      const content = await file.arrayBuffer()
      const newFileHandle = await destDirHandle.getFileHandle(name, { create: true })
      const writable = await newFileHandle.createWritable()
      await writable.write(content)
      await writable.close()
    }
  }
}

/**
 * Move a file or folder to a new parent directory
 */
export async function moveEntry(srcParentHandle, destParentHandle, entryName, isDirectory = false) {
  if (isDirectory) {
    const srcDirHandle = await srcParentHandle.getDirectoryHandle(entryName)
    const destDirHandle = await destParentHandle.getDirectoryHandle(entryName, { create: true })
    await copyDirectoryContents(srcDirHandle, destDirHandle)
    await srcParentHandle.removeEntry(entryName, { recursive: true })
    return destDirHandle
  } else {
    const srcFileHandle = await srcParentHandle.getFileHandle(entryName)
    const file = await srcFileHandle.getFile()
    const content = await file.arrayBuffer()

    const destFileHandle = await destParentHandle.getFileHandle(entryName, { create: true })
    const writable = await destFileHandle.createWritable()
    await writable.write(content)
    await writable.close()

    await srcParentHandle.removeEntry(entryName)
    return destFileHandle
  }
}

/**
 * Get parent directory handle from a path
 */
export async function getParentHandle(rootHandle, path) {
  const parts = path.split('/').filter(Boolean)
  parts.pop() // Remove the file/folder name itself

  let currentHandle = rootHandle
  for (const part of parts) {
    if (part === rootHandle.name) continue // Skip root name
    currentHandle = await currentHandle.getDirectoryHandle(part)
  }
  return currentHandle
}

/**
 * Scaffold a new VibeFoundry project structure
 */
export async function scaffoldProject(rootHandle) {
  // Create main folders
  await rootHandle.getDirectoryHandle('input_folder', { create: true })
  await rootHandle.getDirectoryHandle('output_folder', { create: true })
  const appFolder = await rootHandle.getDirectoryHandle('app_folder', { create: true })

  // Create meta_data and scripts folders inside app_folder
  await appFolder.getDirectoryHandle('meta_data', { create: true })
  await appFolder.getDirectoryHandle('scripts', { create: true })

  // Create CLAUDE.md in app_folder
  const claudeMd = `# Project Context

You are working inside \`app_folder/\`.

## IMPORTANT: Folder Access Rules

**NEVER access \`../input_folder/\` or \`../output_folder/\` directly.**

- Do NOT read files from input_folder
- Do NOT list files in input_folder or output_folder
- Do NOT browse or explore those directories

Instead, read \`meta_data/input_metadata.txt\` to understand what data is available.

## Folder Structure

\`\`\`
project_folder/
├── input_folder/      <- DO NOT ACCESS
├── output_folder/     <- DO NOT ACCESS
└── app_folder/        <- You are here - stay here
    ├── meta_data/     <- Read this for file info
    └── scripts/       <- Save Python scripts here
\`\`\`

## How to Work

1. **Read \`meta_data/input_metadata.txt\`** to see available files, columns, and data types
2. **Write Python scripts** using the template below
3. **Save scripts to \`scripts/\`**
4. **Run the scripts** - the scripts will access the folders, not you

## IMPORTANT: Script Template

**ALWAYS use this template** for scripts so they work from any directory:

\`\`\`python
import os
import pandas as pd

# Get absolute paths (works from any directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
INPUT_FOLDER = os.path.join(PROJECT_DIR, "input_folder")
OUTPUT_FOLDER = os.path.join(PROJECT_DIR, "output_folder")

# Read input files using absolute paths
df = pd.read_csv(os.path.join(INPUT_FOLDER, "your_file.csv"))

# Save output files using absolute paths
df.to_csv(os.path.join(OUTPUT_FOLDER, "result.csv"), index=False)
\`\`\`

**NEVER use relative paths like \`../input_folder/\`** - they break when scripts are run from different directories.

## Metadata

Run \`python metadatafarmer.py\` to refresh metadata after new files are added.

The metadata files contain:
- **Absolute paths** for each file (use these in your scripts!)
- File names
- Row counts
- Column names and data types

**TIP:** The absolute path shown in the metadata can be used directly in your scripts. Just copy the path from the metadata file.
`
  const claudeHandle = await appFolder.getFileHandle('CLAUDE.md', { create: true })
  const claudeWritable = await claudeHandle.createWritable()
  await claudeWritable.write(claudeMd)
  await claudeWritable.close()

  // Create metadatafarmer.py in app_folder
  const metadataFarmer = `import os
import pandas as pd
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_FOLDER = os.path.join(BASE_DIR, 'input_folder')
OUTPUT_FOLDER = os.path.join(BASE_DIR, 'output_folder')
META_DATA_FOLDER = os.path.join(BASE_DIR, 'app_folder', 'meta_data')


def get_csv_metadata(filepath, base_folder):
    """Extract metadata from a single CSV file."""
    stat = os.stat(filepath)
    df_sample = pd.read_csv(filepath, nrows=100)
    row_count = sum(1 for _ in open(filepath, 'r', encoding='utf-8')) - 1

    rel_path = os.path.relpath(filepath, base_folder)

    columns_info = []
    for col in df_sample.columns:
        dtype = str(df_sample[col].dtype)
        columns_info.append(f"    - {col} ({dtype})")

    return {
        'filepath': rel_path,
        'absolute_path': os.path.abspath(filepath),
        'file_size_mb': round(stat.st_size / (1024 * 1024), 2),
        'row_count': row_count,
        'column_count': len(df_sample.columns),
        'columns': columns_info
    }


def format_file_metadata(meta):
    """Format metadata for a single file as readable text."""
    lines = [
        f"File: {meta['filepath']}",
        f"  Absolute Path: {meta['absolute_path']}",
        f"  Size: {meta['file_size_mb']} MB",
        f"  Rows: {meta['row_count']:,}",
        f"  Columns ({meta['column_count']}):",
    ]
    lines.extend(meta['columns'])
    return '\\n'.join(lines)


def scan_folder(folder_path):
    """Recursively scan a folder and return formatted metadata for all CSV files."""
    if not os.path.exists(folder_path):
        return f"Folder does not exist: {folder_path}"

    csv_files = []
    for root, dirs, files in os.walk(folder_path):
        for filename in files:
            if filename.lower().endswith('.csv'):
                csv_files.append(os.path.join(root, filename))

    if not csv_files:
        return "No CSV files found."

    results = []
    for filepath in sorted(csv_files):
        rel_path = os.path.relpath(filepath, folder_path)
        try:
            meta = get_csv_metadata(filepath, folder_path)
            results.append(format_file_metadata(meta))
            print(f"  Scanned: {rel_path}")
        except Exception as e:
            results.append(f"File: {rel_path}\\n  Error: {e}")
            print(f"  Error scanning {rel_path}: {e}")

    return '\\n\\n'.join(results)


def main():
    os.makedirs(META_DATA_FOLDER, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print("Scanning input_folder...")
    input_content = scan_folder(INPUT_FOLDER)
    input_meta_path = os.path.join(META_DATA_FOLDER, 'input_metadata.txt')
    with open(input_meta_path, 'w') as f:
        f.write(f"Input Folder Metadata\\n")
        f.write(f"Folder: {os.path.abspath(INPUT_FOLDER)}\\n")
        f.write(f"Generated: {timestamp}\\n")
        f.write(f"{'=' * 50}\\n\\n")
        f.write(input_content)
    print(f"Saved: {input_meta_path}\\n")

    print("Scanning output_folder...")
    output_content = scan_folder(OUTPUT_FOLDER)
    output_meta_path = os.path.join(META_DATA_FOLDER, 'output_metadata.txt')
    with open(output_meta_path, 'w') as f:
        f.write(f"Output Folder Metadata\\n")
        f.write(f"Folder: {os.path.abspath(OUTPUT_FOLDER)}\\n")
        f.write(f"Generated: {timestamp}\\n")
        f.write(f"{'=' * 50}\\n\\n")
        f.write(output_content)
    print(f"Saved: {output_meta_path}\\n")

    print("Metadata farming complete.")


if __name__ == '__main__':
    main()
`
  const farmerHandle = await appFolder.getFileHandle('metadatafarmer.py', { create: true })
  const farmerWritable = await farmerHandle.createWritable()
  await farmerWritable.write(metadataFarmer)
  await farmerWritable.close()

  // Create placeholder metadata files
  const inputMeta = `Input Folder Metadata
Generated: ${new Date().toISOString()}
==================================================

No CSV files found.

Place your CSV files in input_folder/ and run metadatafarmer.py
`
  const metaFolder = await appFolder.getDirectoryHandle('meta_data')
  const inputMetaHandle = await metaFolder.getFileHandle('input_metadata.txt', { create: true })
  const inputMetaWritable = await inputMetaHandle.createWritable()
  await inputMetaWritable.write(inputMeta)
  await inputMetaWritable.close()

  const outputMeta = `Output Folder Metadata
Generated: ${new Date().toISOString()}
==================================================

No CSV files found.
`
  const outputMetaHandle = await metaFolder.getFileHandle('output_metadata.txt', { create: true })
  const outputMetaWritable = await outputMetaHandle.createWritable()
  await outputMetaWritable.write(outputMeta)
  await outputMetaWritable.close()

  return true
}
