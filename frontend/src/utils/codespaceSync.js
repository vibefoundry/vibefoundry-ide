/**
 * Codespace Sync utilities
 * Handles syncing files between browser and codespace
 */

// Files that should NEVER be synced (data files that belong in input/output folders)
const FORBIDDEN_SYNC_EXTENSIONS = ['.pdf', '.csv', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ppt', '.pptx']

/**
 * Check if a file should be blocked from syncing
 */
function shouldBlockSync(filename) {
  const ext = '.' + filename.split('.').pop().toLowerCase()

  // Block data/presentation files
  if (FORBIDDEN_SYNC_EXTENSIONS.includes(ext)) {
    console.log(`[Sync Safety] Blocked: ${filename} (forbidden extension)`)
    return true
  }

  return false
}

/**
 * Write time_keeper.txt to codespace to keep it alive (appends new lines)
 */
export async function writeTimeKeeper(baseUrl) {
  try {
    const timestamp = new Date().toISOString()
    console.log('[TimeKeeper] Writing ping:', timestamp)

    // Read existing content first
    let existingContent = ""
    try {
      const readResponse = await fetch(`${baseUrl}/scripts/time_keeper.txt`, {
        method: "GET",
        mode: "cors"
      })
      if (readResponse.ok) {
        const data = await readResponse.json()
        existingContent = data.content || ""
      }
    } catch (e) {
      // File doesn't exist yet, that's fine
    }

    // Append new timestamp
    const newContent = existingContent + `Ping: ${timestamp}\n`

    const response = await fetch(`${baseUrl}/scripts/time_keeper.txt`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: newContent })
    })
    if (response.ok) {
      console.log('[TimeKeeper] Ping written successfully')
    } else {
      console.error('[TimeKeeper] Write failed:', response.status)
    }
    return response.ok
  } catch (err) {
    console.error("[TimeKeeper] Write failed:", err)
    return false
  }
}

/**
 * Check if sync server is running
 */
export async function checkSyncServer(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      mode: "cors"
    })
    if (!response.ok) return false
    const data = await response.json()
    return data.status === "ok"
  } catch (err) {
    console.error("Sync server check failed:", err)
    return false
  }
}

/**
 * List scripts from codespace
 */
export async function listScripts(baseUrl) {
  const response = await fetch(`${baseUrl}/scripts`, {
    method: "GET",
    mode: "cors"
  })

  if (!response.ok) {
    throw new Error("Failed to list scripts")
  }

  const data = await response.json()
  return data.scripts || []
}

/**
 * List all files from codespace as a tree
 */
export async function listAllFiles(baseUrl) {
  const response = await fetch(`${baseUrl}/files`, {
    method: "GET",
    mode: "cors"
  })

  if (!response.ok) {
    throw new Error("Failed to list files")
  }

  const data = await response.json()
  return data.tree || null
}

/**
 * Get any file content from codespace
 */
export async function getFile(baseUrl, filepath) {
  const response = await fetch(`${baseUrl}/files/${encodeURIComponent(filepath)}`, {
    method: "GET",
    mode: "cors"
  })

  if (!response.ok) {
    throw new Error(`Failed to get file: ${filepath}`)
  }

  return response.json()
}

/**
 * Get a specific script content
 */
export async function getScript(baseUrl, filename) {
  const response = await fetch(`${baseUrl}/scripts/${encodeURIComponent(filename)}`, {
    method: "GET",
    mode: "cors"
  })

  if (!response.ok) {
    throw new Error(`Failed to get script: ${filename}`)
  }

  return response.json()
}

/**
 * Upload metadata to codespace
 */
export async function uploadMetadata(baseUrl, inputMetadata, outputMetadata) {
  const response = await fetch(`${baseUrl}/metadata`, {
    method: "POST",
    mode: "cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input_metadata: inputMetadata,
      output_metadata: outputMetadata
    })
  })

  if (!response.ok) {
    throw new Error("Failed to upload metadata")
  }

  return response.json()
}

/**
 * Get metadata from codespace
 */
export async function getMetadata(baseUrl) {
  const response = await fetch(`${baseUrl}/metadata`, {
    method: "GET",
    mode: "cors"
  })

  if (!response.ok) {
    throw new Error("Failed to get metadata")
  }

  return response.json()
}

/**
 * Get or create nested directory handle
 */
async function getNestedDirectoryHandle(baseHandle, path) {
  const parts = path.split("/").filter(p => p)
  let current = baseHandle
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true })
  }
  return current
}

/**
 * Sync scripts from codespace to local folder (recursive)
 * @param {string} baseUrl - Codespace sync server URL
 * @param {FileSystemDirectoryHandle} rootHandle - Local project folder handle
 * @param {Object} lastSync - Map of filepath -> lastModified for tracking changes
 * @returns {Object} - Updated lastSync map and list of synced files
 */
export async function syncScriptsToLocal(baseUrl, rootHandle, lastSync = {}) {
  const syncedFiles = []
  const newLastSync = { ...lastSync }

  try {
    // Get all files from app_folder on codespace
    const scripts = await listScripts(baseUrl)

    // Get or create local app_folder
    const appFolder = await rootHandle.getDirectoryHandle("app_folder", { create: true })

    // Check each file for changes
    for (const script of scripts) {
      const filePath = script.path || script.name
      const lastMod = lastSync[filePath]
      // Round timestamps to avoid floating-point precision issues
      const serverMod = Math.floor(script.modified)
      const localMod = lastMod ? Math.floor(lastMod) : 0

      // Download if new or modified
      if (!lastMod || localMod < serverMod) {
        const scriptData = await getScript(baseUrl, filePath)

        // Create parent directories if needed
        const dirPath = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : ""
        const fileName = filePath.includes("/") ? filePath.substring(filePath.lastIndexOf("/") + 1) : filePath

        const targetFolder = dirPath
          ? await getNestedDirectoryHandle(appFolder, dirPath)
          : appFolder

        // Write to local file
        const fileHandle = await targetFolder.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(scriptData.content)
        await writable.close()

        newLastSync[filePath] = serverMod
        syncedFiles.push(filePath)
      } else {
        newLastSync[filePath] = lastMod
      }
    }

    return { lastSync: newLastSync, syncedFiles }
  } catch (err) {
    console.error("Sync error:", err)
    throw err
  }
}

/**
 * Sync metadata from local folder to codespace
 * @param {string} baseUrl - Codespace sync server URL
 * @param {FileSystemDirectoryHandle} rootHandle - Local project folder handle
 */
export async function syncMetadataToCodespace(baseUrl, rootHandle) {
  try {
    // Get local metadata
    const appFolder = await rootHandle.getDirectoryHandle("app_folder", { create: false })
    const metaFolder = await appFolder.getDirectoryHandle("meta_data", { create: false })

    let inputMetadata = ""
    let outputMetadata = ""

    try {
      const inputFile = await metaFolder.getFileHandle("input_metadata.txt")
      const inputContent = await inputFile.getFile()
      inputMetadata = await inputContent.text()
    } catch (e) {
      // File doesn't exist
    }

    try {
      const outputFile = await metaFolder.getFileHandle("output_metadata.txt")
      const outputContent = await outputFile.getFile()
      outputMetadata = await outputContent.text()
    } catch (e) {
      // File doesn't exist
    }

    // Upload to codespace
    if (inputMetadata || outputMetadata) {
      await uploadMetadata(baseUrl, inputMetadata, outputMetadata)
      return true
    }

    return false
  } catch (err) {
    // Folder doesn't exist yet, that's ok
    console.log("No metadata to sync yet")
    return false
  }
}

/**
 * Upload a script to codespace
 */
export async function uploadScript(baseUrl, filename, content) {
  // Safety check: block forbidden files
  if (shouldBlockSync(filename)) {
    throw new Error(`Upload blocked: ${filename} is a forbidden file type`)
  }

  const response = await fetch(`${baseUrl}/scripts/${encodeURIComponent(filename)}`, {
    method: "POST",
    mode: "cors",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  })

  if (!response.ok) {
    throw new Error(`Failed to upload script: ${filename}`)
  }

  return response.json()
}

/**
 * Recursively collect all files from a directory
 * Filters out forbidden file types (CSV, XLSX, JSON, large TXT)
 * @param {FileSystemDirectoryHandle} dirHandle - Directory to scan
 * @param {string} prefix - Path prefix for nested files
 * @param {string[]} protectedFiles - Filenames to skip
 * @param {string[]} protectedDirs - Directory names to skip
 */
async function collectFilesRecursive(dirHandle, prefix = "", protectedFiles = [], protectedDirs = []) {
  const files = []
  for await (const entry of dirHandle.values()) {
    // Skip hidden files, node_modules, and protected dirs
    if (entry.name.startsWith(".") || entry.name === "node_modules" || protectedDirs.includes(entry.name)) {
      continue
    }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === "file") {
      // Skip protected files
      if (protectedFiles.includes(entry.name)) {
        continue
      }

      const file = await entry.getFile()

      // Safety check: block forbidden files from syncing
      if (shouldBlockSync(entry.name)) {
        continue
      }

      const content = await file.text()
      files.push({ path, content })
    } else if (entry.kind === "directory") {
      const subFiles = await collectFilesRecursive(entry, path, protectedFiles, protectedDirs)
      files.push(...subFiles)
    }
  }
  return files
}

/**
 * Push all local scripts to codespace (recursive)
 * @param {string} baseUrl - Codespace sync server URL
 * @param {FileSystemDirectoryHandle} rootHandle - Local project folder handle
 * @returns {Object} - List of pushed files
 */
// Files that should never be pushed to codespace (server-side files)
const PROTECTED_FILES = ['sync_server.py', 'metadatafarmer.py', 'CLAUDE.md']
const PROTECTED_DIRS = ['meta_data']

export async function pushScriptsToCodespace(baseUrl, rootHandle) {
  const pushedFiles = []

  try {
    // Get local app_folder
    const appFolder = await rootHandle.getDirectoryHandle("app_folder", { create: false })

    // Recursively collect all files (excluding protected ones)
    const files = await collectFilesRecursive(appFolder, "", PROTECTED_FILES, PROTECTED_DIRS)

    // Upload each file with its path
    for (const file of files) {
      await uploadScript(baseUrl, file.path, file.content)
      pushedFiles.push(file.path)
    }

    return { pushedFiles }
  } catch (err) {
    console.error("Push scripts error:", err)
    throw err
  }
}

/**
 * Reset codespace to latest dev-branch (git reset --hard && git pull)
 */
export async function resetCodespace(baseUrl) {
  const response = await fetch(`${baseUrl}/reset`, {
    method: "POST",
    mode: "cors"
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.message || "Failed to reset codespace")
  }

  return response.json()
}

/**
 * Run full bidirectional sync
 */
export async function runFullSync(baseUrl, rootHandle, lastSync = {}) {
  const result = {
    scriptsSync: null,
    metadataSync: false,
    error: null
  }

  try {
    // Sync scripts from codespace to local
    result.scriptsSync = await syncScriptsToLocal(baseUrl, rootHandle, lastSync)

    // Sync metadata from local to codespace
    result.metadataSync = await syncMetadataToCodespace(baseUrl, rootHandle)

    return result
  } catch (err) {
    result.error = err.message
    return result
  }
}
