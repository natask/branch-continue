package com.natnael.branchcontinue.microphonepermission

import android.Manifest
import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
  ]
)
class MicrophonePermissionPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun requestMicrophone(invoke: Invoke) {
    requestPermissionForAlias("microphone", invoke, "checkPermissions")
  }

  @Command
  @PermissionCallback
  override fun checkPermissions(invoke: Invoke) {
    super.checkPermissions(invoke)
  }
}
