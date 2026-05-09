package com.natnael.branchcontinue.sourcefile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
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
