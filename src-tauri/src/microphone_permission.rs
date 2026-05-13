use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Manager, Runtime, State, Wry,
};

const PLUGIN_NAME: &str = "microphone-permission-mobile";

#[derive(Clone)]
pub struct MicrophonePermissionMobile<R: Runtime>(Option<PluginHandle<R>>);

#[derive(Debug, Serialize)]
#[cfg(target_os = "android")]
struct EmptyPayload {}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophonePermissionState {
    microphone: Option<serde_json::Value>,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new(PLUGIN_NAME)
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = Some(_api.register_android_plugin(
                "com.natnael.branchcontinue.microphonepermission",
                "MicrophonePermissionPlugin",
            )?);

            #[cfg(not(target_os = "android"))]
            let handle: Option<PluginHandle<R>> = None;

            app.manage(MicrophonePermissionMobile(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn android_request_microphone_permission(
    microphone: State<'_, MicrophonePermissionMobile<Wry>>,
) -> Result<MicrophonePermissionState, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = microphone.0.as_ref().ok_or_else(|| {
            "Android microphone permission is only available on Android.".to_string()
        })?;

        return run_mobile(plugin, "requestMicrophone", EmptyPayload {}).await;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = microphone;
        Ok(MicrophonePermissionState {
            microphone: Some(serde_json::Value::String("granted".to_string())),
        })
    }
}

#[cfg(target_os = "android")]
async fn run_mobile<R, P, T>(
    plugin: &PluginHandle<R>,
    command: &'static str,
    payload: P,
) -> Result<T, String>
where
    R: Runtime,
    P: Serialize,
    T: for<'de> Deserialize<'de>,
{
    plugin
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|error| error.to_string())
}
