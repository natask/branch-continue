package com.natnael.branchcontinue.sourcefile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.DocumentsContract
import android.content.Context
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

@InvokeArg
class SourceUriArgs {
  lateinit var uri: String
}

@InvokeArg
class WriteSourceArgs {
  lateinit var uri: String
  lateinit var content: String
}

@InvokeArg
class SaveAudioArgs {
  lateinit var sourceUri: String
  lateinit var relativePath: String
  lateinit var mimeType: String
  lateinit var base64: String
  var metadataJson: String? = null
}

@InvokeArg
class ReadAudioArgs {
  lateinit var sourceUri: String
  lateinit var relativePath: String
}

@TauriPlugin
class SourceFilePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun selectSourceFile(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = "*/*"
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      startActivityForResult(invoke, intent, "selectSourceFileResult")
    } catch (ex: Exception) {
      reject(invoke, "Failed to open source picker", ex)
    }
  }

  @ActivityCallback
  fun selectSourceFileResult(invoke: Invoke, result: ActivityResult) {
    try {
      when (result.resultCode) {
        Activity.RESULT_OK -> {
          val data = result.data
          val uri = data?.data
          if (uri == null) {
            invoke.resolve(null)
            return
          }

          persistUriPermission(uri, data.flags)

          val response = JSObject()
          response.put("uri", uri.toString())
          response.put("name", displayName(uri))
          invoke.resolve(response)
        }
        Activity.RESULT_CANCELED -> invoke.reject("Source file picker cancelled")
        else -> invoke.reject("Failed to pick source file")
      }
    } catch (ex: Exception) {
      reject(invoke, "Failed to read source picker result", ex)
    }
  }

  @Command
  fun readSourceFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SourceUriArgs::class.java)
      val uri = Uri.parse(args.uri)
      val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        input.copyTo(output)
        output.toByteArray()
      } ?: ByteArray(0)

      val response = JSObject()
      response.put("content", String(bytes, StandardCharsets.UTF_8))
      invoke.resolve(response)
    } catch (ex: Exception) {
      reject(invoke, "Failed to read source file", ex)
    }
  }

  @Command
  fun writeSourceFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WriteSourceArgs::class.java)
      val uri = Uri.parse(args.uri)
      val bytes = args.content.toByteArray(StandardCharsets.UTF_8)

      activity.contentResolver.openOutputStream(uri, "wt")?.use { output ->
        output.write(bytes)
        output.flush()
      } ?: throw IllegalStateException("Could not open source file for writing")

      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      reject(invoke, "Failed to write source file", ex)
    }
  }

  private val audioDirectories by lazy {
    activity.getSharedPreferences("source-audio-directories", Context.MODE_PRIVATE)
  }
  private data class PendingAudioCall(val invoke: Invoke, val save: Boolean)
  private val pendingAudioSaves = java.util.ArrayDeque<PendingAudioCall>()
  private var pickingAudioDirectory = false

  @Command
  fun saveAudioCapture(invoke: Invoke) {
    // Folder grants are interactive. Serialize requests so concurrent sidecar saves
    // share the first successful grant instead of opening overlapping pickers.
    activity.runOnUiThread {
      pendingAudioSaves.addLast(PendingAudioCall(invoke, true))
      drainAudioSaves()
    }
  }

  private fun grantedAudioTree(sourceUri: String): String? {
    val stored = audioDirectories.getString(sourceUri, null) ?: return null
    val hasGrant = activity.contentResolver.persistedUriPermissions.any {
      it.uri.toString() == stored && it.isReadPermission && it.isWritePermission
    }
    if (hasGrant) return stored
    audioDirectories.edit().remove(sourceUri).apply()
    return null
  }

  private fun drainAudioSaves() {
    if (pickingAudioDirectory) return
    while (pendingAudioSaves.isNotEmpty()) {
      val request = pendingAudioSaves.first
      val invoke = request.invoke
      try {
        val args = invoke.parseArgs(ReadAudioArgs::class.java)
        safeAudioPath(args.relativePath)
        val tree = grantedAudioTree(args.sourceUri)
        if (tree == null) {
          pickingAudioDirectory = true
          val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
          intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(args.sourceUri))
          startActivityForResult(invoke, intent, "audioDirectoryResult")
          return
        }
        if (request.save) {
          writeAudio(invoke, invoke.parseArgs(SaveAudioArgs::class.java), Uri.parse(tree))
        } else {
          readAudio(invoke)
        }
      } catch (ex: Exception) {
        reject(invoke, "Failed to save source audio", ex)
      }
      pendingAudioSaves.removeFirst()
    }
  }

  @ActivityCallback
  fun audioDirectoryResult(invoke: Invoke, result: ActivityResult) {
    try {
      val tree = result.data?.data
      if (result.resultCode != Activity.RESULT_OK || tree == null) {
        throw IllegalStateException("Choose the folder containing your source file to store recordings beside it")
      }
      val args = invoke.parseArgs(ReadAudioArgs::class.java)
      val sourceUri = Uri.parse(args.sourceUri)
      require(tree.authority == sourceUri.authority) {
        "The selected folder must use the same storage provider as the source file"
      }
      val sourceId = DocumentsContract.getDocumentId(sourceUri)
      val rootId = DocumentsContract.getTreeDocumentId(tree)
      val source = findChild(tree, rootId, null, sourceId)
      if (source == null) {
        throw IllegalArgumentException("The selected folder must contain the current source file")
      }
      val granted = result.data!!.flags and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (granted != (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) {
        throw SecurityException("The source folder needs read and write access")
      }
      activity.contentResolver.takePersistableUriPermission(tree, granted)
      audioDirectories.edit().putString(args.sourceUri, tree.toString()).apply()
    } catch (ex: Exception) {
      // Reject all waiting requests for this source; cancellation must not trigger
      // another prompt for each queued transcript or waveform sidecar.
      val source = runCatching { invoke.parseArgs(ReadAudioArgs::class.java).sourceUri }.getOrNull()
      val iterator = pendingAudioSaves.iterator()
      while (iterator.hasNext()) {
        val waiting = iterator.next().invoke
        if (runCatching { waiting.parseArgs(ReadAudioArgs::class.java).sourceUri }.getOrNull() == source) {
          reject(waiting, "Failed to grant source audio folder access", ex)
          iterator.remove()
        }
      }
    } finally {
      pickingAudioDirectory = false
      drainAudioSaves()
    }
  }

  @Command
  fun readAudioCapture(invoke: Invoke) {
    activity.runOnUiThread {
      pendingAudioSaves.addLast(PendingAudioCall(invoke, false))
      drainAudioSaves()
    }
  }

  private fun readAudio(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ReadAudioArgs::class.java)
      val segments = safeAudioPath(args.relativePath)
      val treeValue = audioDirectories.getString(args.sourceUri, null)
        ?: throw SecurityException("Source audio folder access has not been granted on this device")
      val tree = Uri.parse(treeValue)
      val file = resolveAudioFile(tree, segments, false, "application/octet-stream")
      val response = JSObject()
      if (file != null) {
        val bytes = activity.contentResolver.openInputStream(file)?.use { it.readBytes() }
          ?: throw IllegalStateException("Could not read recording")
        response.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        response.put("mimeType", activity.contentResolver.getType(file))
        val metadata = resolveAudioFile(tree, safeAudioPath(args.relativePath + ".json"), false, "application/json")
        if (metadata != null) {
          response.put("metadataJson", activity.contentResolver.openInputStream(metadata)?.use {
            String(it.readBytes(), StandardCharsets.UTF_8)
          })
        }
      }
      invoke.resolve(response)
    } catch (ex: Exception) {
      reject(invoke, "Failed to read source audio", ex)
    }
  }

  private fun writeAudio(invoke: Invoke, args: SaveAudioArgs, tree: Uri) {
    // Decode before creating any documents so malformed payloads leave no files.
    val bytes = Base64.decode(args.base64, Base64.DEFAULT)
    val file = resolveAudioFile(tree, safeAudioPath(args.relativePath), true, args.mimeType)
      ?: throw IllegalStateException("Could not create recording")
    writeBytes(file, bytes)
    args.metadataJson?.let { metadata ->
      val sidecar = resolveAudioFile(tree, safeAudioPath(args.relativePath + ".json"), true, "application/json")
        ?: throw IllegalStateException("Could not create recording metadata")
      writeBytes(sidecar, metadata.toByteArray(StandardCharsets.UTF_8))
    }
    val response = JSObject()
    response.put("uri", file.toString())
    response.put("relativePath", args.relativePath)
    invoke.resolve(response)
  }

  private fun writeBytes(uri: Uri, bytes: ByteArray) {
    activity.contentResolver.openOutputStream(uri, "wt")?.use {
      it.write(bytes)
      it.flush()
    } ?: throw IllegalStateException("Could not write recording")
  }

  private fun safeAudioPath(path: String): List<String> {
    val segments = path.split('/')
    require(segments.size >= 2 && segments.first() == "recordings" &&
      segments.all { it.isNotEmpty() && it != "." && it != ".." &&
        !it.contains('\\') && !it.contains('\u0000') }) {
      "Audio paths must stay inside the source recordings folder"
    }
    return segments
  }

  private fun resolveAudioFile(tree: Uri, segments: List<String>, create: Boolean, mime: String): Uri? {
    var parentId = DocumentsContract.getTreeDocumentId(tree)
    var current: Uri? = null
    segments.forEachIndexed { index, name ->
      val isDirectory = index < segments.lastIndex
      current = findChild(tree, parentId, name, null)
      if (current == null && create) {
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, parentId)
        current = DocumentsContract.createDocument(activity.contentResolver, parent,
          if (isDirectory) DocumentsContract.Document.MIME_TYPE_DIR else mime, name)
      }
      val document = current ?: return null
      if (isDirectory && activity.contentResolver.getType(document) != DocumentsContract.Document.MIME_TYPE_DIR) {
        throw IllegalStateException("Recording path component is not a directory: $name")
      }
      parentId = DocumentsContract.getDocumentId(document)
    }
    return current
  }

  private fun findChild(tree: Uri, parentId: String, name: String?, documentId: String?): Uri? {
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
    val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME)
    val cursor = activity.contentResolver.query(children, projection, null, null, null)
      ?: throw IllegalStateException("Could not list source folder")
    cursor.use {
      while (it.moveToNext()) {
        val id = it.getString(0)
        if ((documentId != null && id == documentId) || (name != null && it.getString(1) == name)) {
          return DocumentsContract.buildDocumentUriUsingTree(tree, id)
        }
      }
    }
    return null
  }

  private fun persistUriPermission(uri: Uri, intentFlags: Int) {
    val requestedFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    val availableFlags = intentFlags and requestedFlags
    if (availableFlags == 0) return

    try {
      activity.contentResolver.takePersistableUriPermission(uri, availableFlags)
    } catch (ex: SecurityException) {
      Logger.warn("Failed to persist source URI permission: ${ex.message}")
    }
  }

  private fun displayName(uri: Uri): String {
    val projection = arrayOf(OpenableColumns.DISPLAY_NAME)
    activity.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0) {
          val value = cursor.getString(column)
          if (!value.isNullOrBlank()) return value
        }
      }
    }

    return uri.lastPathSegment ?: "Selected source"
  }

  private fun reject(invoke: Invoke, prefix: String, ex: Exception) {
    val message = "$prefix: ${ex.message ?: ex.javaClass.simpleName}"
    Logger.error(message)
    invoke.reject(message)
  }
}
