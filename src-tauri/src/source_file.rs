use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin},
    Manager, Runtime, State, Wry,
};

const PLUGIN_NAME: &str = "source-file-mobile";

#[derive(Clone)]
pub struct SourceFileMobile<R: Runtime>(Option<PluginHandle<R>>);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFileSelection {
    uri: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFileContent {
    content: String,
}

#[derive(Debug, Serialize)]
#[cfg(target_os = "android")]
struct EmptyPayload {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "android")]
struct UriPayload<'a> {
    uri: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ReadSourceFilePayload {
    uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "android")]
struct WriteSourceFileMobilePayload<'a> {
    uri: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WriteSourceFilePayload {
    uri: String,
    content: String,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new(PLUGIN_NAME)
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = Some(_api.register_android_plugin(
                "com.natnael.branchcontinue.sourcefile",
                "SourceFilePlugin",
            )?);

            #[cfg(not(target_os = "android"))]
            let handle: Option<PluginHandle<R>> = None;

            app.manage(SourceFileMobile(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn android_select_source_file(
    source_file: State<'_, SourceFileMobile<Wry>>,
) -> Result<Option<SourceFileSelection>, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = source_file
            .0
            .as_ref()
            .ok_or_else(|| "Android source picker is only available on Android.".to_string())?;

        return run_mobile(plugin, "selectSourceFile", EmptyPayload {}).await;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = source_file;
        Err("Android source picker is only available on Android.".to_string())
    }
}

#[tauri::command]
pub async fn android_read_source_file(
    source_file: State<'_, SourceFileMobile<Wry>>,
    payload: ReadSourceFilePayload,
) -> Result<SourceFileContent, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = source_file
            .0
            .as_ref()
            .ok_or_else(|| "Android source reader is only available on Android.".to_string())?;

        return run_mobile(plugin, "readSourceFile", UriPayload { uri: &payload.uri }).await;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = source_file;
        let _ = payload;
        Err("Android source reader is only available on Android.".to_string())
    }
}

#[tauri::command]
pub async fn android_write_source_file(
    source_file: State<'_, SourceFileMobile<Wry>>,
    payload: WriteSourceFilePayload,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let plugin = source_file
            .0
            .as_ref()
            .ok_or_else(|| "Android source writer is only available on Android.".to_string())?;

        let _: serde_json::Value = run_mobile(
            plugin,
            "writeSourceFile",
            WriteSourceFileMobilePayload {
                uri: &payload.uri,
                content: &payload.content,
            },
        )
        .await?;

        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = source_file;
        let _ = payload;
        Err("Android source writer is only available on Android.".to_string())
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
