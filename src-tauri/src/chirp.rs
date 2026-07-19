use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const TOKEN_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const CLOUD_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";
const EMBEDDED_GCP_PROJECT_ID: Option<&str> = option_env!("BRANCH_CONTINUE_GCP_PROJECT_ID");
const EMBEDDED_GCP_LOCATION: Option<&str> = option_env!("BRANCH_CONTINUE_GCP_LOCATION");
const EMBEDDED_CHIRP_MODEL: Option<&str> = option_env!("BRANCH_CONTINUE_CHIRP_MODEL");
const EMBEDDED_GCP_SERVICE_ACCOUNT_KEY: Option<&str> =
    option_env!("BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY");
const EMBEDDED_LEGACY_GCP_PROJECT_ID: Option<&str> = option_env!("GCP_PROJECT_ID");
const EMBEDDED_LEGACY_GCP_LOCATION: Option<&str> = option_env!("GCP_LOCATION");
const EMBEDDED_LEGACY_CHIRP_MODEL: Option<&str> = option_env!("CHIRP_MODEL");
const EMBEDDED_LEGACY_GCP_SERVICE_ACCOUNT_KEY: Option<&str> =
    option_env!("GCP_SERVICE_ACCOUNT_KEY");
const DEFAULT_CHIRP_MODEL: &str = "chirp_3";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChirpTranscribePayload {
    audio_base64: String,
    language_code: String,
    language_codes: Option<Vec<String>>,
    custom_prompt: Option<String>,
    mime_type: Option<String>,
    project_id: Option<String>,
    location: Option<String>,
    model: Option<String>,
    service_account_key_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChirpTranscribeResponse {
    transcript: String,
    words: Vec<ChirpTranscribedWord>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ChirpTranscribedWord {
    text: String,
    start_ms: u64,
    end_ms: u64,
}

#[derive(Debug, Deserialize)]
struct ServiceAccountKey {
    private_key: String,
    private_key_id: Option<String>,
    client_email: String,
    project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthorizedUserCredentials {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    token_uri: Option<String>,
    quota_project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum GoogleCredentials {
    ServiceAccount(ServiceAccountKey),
    AuthorizedUser(AuthorizedUserCredentials),
}

impl GoogleCredentials {
    fn project_id(&self) -> Option<&str> {
        match self {
            Self::ServiceAccount(credentials) => credentials.project_id.as_deref(),
            Self::AuthorizedUser(_) => None,
        }
    }

    fn quota_project_id(&self) -> Option<&str> {
        match self {
            Self::ServiceAccount(_) => None,
            Self::AuthorizedUser(credentials) => credentials.quota_project_id.as_deref(),
        }
    }
}

#[derive(Debug, Serialize)]
struct JwtClaims<'a> {
    iss: &'a str,
    sub: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
    scope: &'a str,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
}

#[derive(Debug)]
struct UpstreamError {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn transcribe_with_chirp(
    payload: ChirpTranscribePayload,
) -> Result<ChirpTranscribeResponse, String> {
    let audio_base64 = payload.audio_base64.trim();
    if audio_base64.is_empty() {
        return Err("Missing audio data.".to_string());
    }

    let language_code = clean_required(&payload.language_code, "language code")?;
    let credentials_raw = load_google_credentials(payload.service_account_key_path.as_deref())?;
    let credentials = parse_google_credentials(&credentials_raw)?;
    let env_project_id =
        env_or_embedded_value("BRANCH_CONTINUE_GCP_PROJECT_ID", EMBEDDED_GCP_PROJECT_ID);
    let env_project_id_fallback =
        env_or_embedded_value("GCP_PROJECT_ID", EMBEDDED_LEGACY_GCP_PROJECT_ID);
    let adc_project_id = env_value("GOOGLE_CLOUD_PROJECT").or_else(|| env_value("GCLOUD_PROJECT"));
    let env_location = env_or_embedded_value("BRANCH_CONTINUE_GCP_LOCATION", EMBEDDED_GCP_LOCATION);
    let env_location_fallback = env_or_embedded_value("GCP_LOCATION", EMBEDDED_LEGACY_GCP_LOCATION);
    let env_model = env_or_embedded_value("BRANCH_CONTINUE_CHIRP_MODEL", EMBEDDED_CHIRP_MODEL);
    let env_model_fallback = env_or_embedded_value("CHIRP_MODEL", EMBEDDED_LEGACY_CHIRP_MODEL);
    let project_id = first_non_empty([
        payload.project_id.as_deref(),
        env_project_id.as_deref(),
        env_project_id_fallback.as_deref(),
        adc_project_id.as_deref(),
        credentials.project_id(),
    ])
    .or_else(discover_gcloud_project)
    .ok_or_else(|| "Missing GCP project id. Set it in recording config, GOOGLE_CLOUD_PROJECT, or the active gcloud configuration.".to_string())?;
    let location = first_non_empty([
        payload.location.as_deref(),
        env_location.as_deref(),
        env_location_fallback.as_deref(),
        Some("us"),
    ])
    .unwrap_or_else(|| "us".to_string());
    let model = normalize_chirp_model(
        &first_non_empty([
            payload.model.as_deref(),
            env_model.as_deref(),
            env_model_fallback.as_deref(),
            Some(DEFAULT_CHIRP_MODEL),
        ])
        .unwrap_or_else(|| DEFAULT_CHIRP_MODEL.to_string()),
    )?;
    let language_codes =
        resolve_language_codes(payload.language_codes.as_deref(), &language_code, &model);

    let client = reqwest::Client::new();
    let access_token = get_access_token(&client, &credentials).await?;
    let quota_project_id = credentials.quota_project_id();
    let endpoint = speech_endpoint(&project_id, &location);
    let features = recognition_features(payload.custom_prompt.as_deref());
    let explicit_encoding = explicit_audio_encoding(payload.mime_type.as_deref());
    let body = match explicit_encoding {
        Some(encoding) => json!({
            "config": {
                "explicitDecodingConfig": {
                    "encoding": encoding,
                    "sampleRateHertz": 48000,
                    "audioChannelCount": 1
                },
                "languageCodes": language_codes,
                "model": model,
                "features": features
            },
            "content": audio_base64
        }),
        None => auto_decoding_body(audio_base64, &language_codes, &model, features.clone()),
    };

    let response_text =
        match post_recognize(&client, &endpoint, &access_token, quota_project_id, body).await {
            Ok(text) => text,
            Err(err) if err.status == 400 && explicit_encoding.is_some() => {
                let fallback = auto_decoding_body(audio_base64, &language_codes, &model, features);
                post_recognize(
                    &client,
                    &endpoint,
                    &access_token,
                    quota_project_id,
                    fallback,
                )
                .await
                .map_err(format_upstream_error)?
            }
            Err(err) => return Err(format_upstream_error(err)),
        };
    parse_transcription(&response_text)
}

async fn get_access_token(
    client: &reqwest::Client,
    credentials: &GoogleCredentials,
) -> Result<String, String> {
    match credentials {
        GoogleCredentials::ServiceAccount(service_account) => {
            get_service_account_access_token(client, service_account).await
        }
        GoogleCredentials::AuthorizedUser(authorized_user) => {
            get_authorized_user_access_token(client, authorized_user).await
        }
    }
}

async fn get_service_account_access_token(
    client: &reqwest::Client,
    service_account: &ServiceAccountKey,
) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Clock error: {error}"))?
        .as_secs();
    let mut header = Header::new(Algorithm::RS256);
    header.kid = service_account.private_key_id.clone();
    let claims = JwtClaims {
        iss: &service_account.client_email,
        sub: &service_account.client_email,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
        scope: CLOUD_SCOPE,
    };
    let encoding_key = EncodingKey::from_rsa_pem(service_account.private_key.as_bytes())
        .map_err(|error| format!("Invalid GCP private key: {error}"))?;
    let jwt = encode(&header, &claims, &encoding_key)
        .map_err(|error| format!("Failed to sign GCP JWT: {error}"))?;

    let response = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", TOKEN_GRANT_TYPE),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("GCP token exchange failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read GCP token response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "GCP token exchange failed ({}): {}",
            status.as_u16(),
            body
        ));
    }

    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid GCP token response: {error}"))?;
    let _ = parsed.expires_in;
    Ok(parsed.access_token)
}

async fn get_authorized_user_access_token(
    client: &reqwest::Client,
    credentials: &AuthorizedUserCredentials,
) -> Result<String, String> {
    let token_uri = credentials.token_uri.as_deref().unwrap_or(TOKEN_URL);
    let response = client
        .post(token_uri)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", credentials.client_id.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("refresh_token", credentials.refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("Google ADC token refresh failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Google ADC token response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Google ADC token refresh failed ({}): {}",
            status.as_u16(),
            body
        ));
    }

    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid Google ADC token response: {error}"))?;
    Ok(parsed.access_token)
}

async fn post_recognize(
    client: &reqwest::Client,
    endpoint: &str,
    access_token: &str,
    quota_project_id: Option<&str>,
    body: Value,
) -> Result<String, UpstreamError> {
    let mut request = client.post(endpoint).bearer_auth(access_token).json(&body);
    if let Some(quota_project_id) = quota_project_id.and_then(clean_optional) {
        request = request.header("x-goog-user-project", quota_project_id);
    }
    let response = request.send().await.map_err(|error| UpstreamError {
        status: 0,
        body: error.to_string(),
    })?;
    let status = response.status();
    let response_body = response.text().await.map_err(|error| UpstreamError {
        status: status.as_u16(),
        body: error.to_string(),
    })?;

    if !status.is_success() {
        return Err(UpstreamError {
            status: status.as_u16(),
            body: response_body,
        });
    }

    Ok(response_body)
}

fn auto_decoding_body(
    audio_base64: &str,
    language_codes: &[String],
    model: &str,
    features: Value,
) -> Value {
    json!({
        "config": {
            "autoDecodingConfig": {},
            "languageCodes": language_codes,
            "model": model,
            "features": features
        },
        "content": audio_base64
    })
}

fn recognition_features(custom_prompt: Option<&str>) -> Value {
    let mut features = json!({
        "enableAutomaticPunctuation": true,
        "enableWordTimeOffsets": true
    });
    if let Some(custom_prompt) = custom_prompt.and_then(clean_optional) {
        features["customPromptConfig"] = json!({ "customPrompt": custom_prompt });
    }
    features
}

fn resolve_language_codes(
    _configured: Option<&[String]>,
    fallback: &str,
    model: &str,
) -> Vec<String> {
    if model == DEFAULT_CHIRP_MODEL {
        return vec!["auto".to_string()];
    }
    vec![fallback.to_string()]
}

fn parse_transcription(response_text: &str) -> Result<ChirpTranscribeResponse, String> {
    let data: Value = serde_json::from_str(response_text)
        .map_err(|error| format!("Invalid Speech-to-Text response: {error}"))?;
    let Some(results) = data.get("results").and_then(Value::as_array) else {
        return Ok(ChirpTranscribeResponse {
            transcript: "(no speech detected)".to_string(),
            words: Vec::new(),
        });
    };
    let transcript = results
        .iter()
        .filter_map(|result| {
            result
                .get("alternatives")
                .and_then(Value::as_array)
                .and_then(|alternatives| alternatives.first())
                .and_then(|alternative| alternative.get("transcript"))
                .and_then(Value::as_str)
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    let words = results
        .iter()
        .filter_map(|result| {
            result
                .get("alternatives")
                .and_then(Value::as_array)
                .and_then(|alternatives| alternatives.first())
        })
        .flat_map(|alternative| {
            alternative
                .get("words")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(parse_transcribed_word)
        .collect();

    if transcript.is_empty() {
        Ok(ChirpTranscribeResponse {
            transcript: "(no speech detected)".to_string(),
            words: Vec::new(),
        })
    } else {
        Ok(ChirpTranscribeResponse { transcript, words })
    }
}

fn parse_transcribed_word(value: &Value) -> Option<ChirpTranscribedWord> {
    let text = value.get("word").and_then(Value::as_str)?.trim();
    if text.is_empty() {
        return None;
    }

    let start_ms = parse_google_duration_ms(value.get("startOffset")?)?;
    let end_ms = parse_google_duration_ms(value.get("endOffset")?).unwrap_or(start_ms);
    Some(ChirpTranscribedWord {
        text: text.to_string(),
        start_ms,
        end_ms: end_ms.max(start_ms),
    })
}

fn parse_google_duration_ms(value: &Value) -> Option<u64> {
    if let Some(duration) = value.as_str() {
        let seconds = duration.strip_suffix('s')?.parse::<f64>().ok()?;
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        return Some((seconds * 1_000.0).round() as u64);
    }

    let object = value.as_object()?;
    let seconds = object
        .get("seconds")
        .and_then(|seconds| seconds.as_i64().or_else(|| seconds.as_str()?.parse().ok()))
        .unwrap_or(0);
    let nanos = object
        .get("nanos")
        .and_then(|nanos| nanos.as_i64().or_else(|| nanos.as_str()?.parse().ok()))
        .unwrap_or(0);
    if seconds < 0 || nanos < 0 {
        return None;
    }
    Some((seconds as u64).saturating_mul(1_000) + ((nanos as u64 + 500_000) / 1_000_000))
}

fn load_google_credentials(path: Option<&str>) -> Result<String, String> {
    if let Some(clean_path) = path.and_then(clean_optional) {
        return fs::read_to_string(&clean_path)
            .map_err(|error| format!("Failed to read Google credential path: {error}"));
    }

    for (name, embedded) in [
        (
            "BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY",
            EMBEDDED_GCP_SERVICE_ACCOUNT_KEY,
        ),
        (
            "GCP_SERVICE_ACCOUNT_KEY",
            EMBEDDED_LEGACY_GCP_SERVICE_ACCOUNT_KEY,
        ),
    ] {
        if let Some(value) = env_or_embedded_value(name, embedded) {
            return Ok(value);
        }
    }

    if let Some(path) = env_value("GOOGLE_APPLICATION_CREDENTIALS") {
        return fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read GOOGLE_APPLICATION_CREDENTIALS: {error}"));
    }

    if let Some(path) = default_adc_path().filter(|path| path.is_file()) {
        return fs::read_to_string(&path).map_err(|error| {
            format!(
                "Failed to read default Google ADC file {}: {error}",
                path.display()
            )
        });
    }

    Err("Missing Google credentials. Run `gcloud auth application-default login`, set GOOGLE_APPLICATION_CREDENTIALS, or choose an ADC/service-account JSON file in recording config.".to_string())
}

fn parse_google_credentials(raw: &str) -> Result<GoogleCredentials, String> {
    serde_json::from_str(raw.trim())
        .or_else(|_| serde_json::from_str(&raw.replace('\n', "\\n")))
        .map_err(|error| format!("Unsupported Google credential JSON: {error}"))
}

fn default_gcloud_config_dir() -> Option<PathBuf> {
    env_value("CLOUDSDK_CONFIG")
        .map(PathBuf::from)
        .or_else(|| env_value("HOME").map(|home| Path::new(&home).join(".config/gcloud")))
}

fn default_adc_path() -> Option<PathBuf> {
    default_gcloud_config_dir().map(|dir| dir.join("application_default_credentials.json"))
}

fn discover_gcloud_project() -> Option<String> {
    let config_dir = default_gcloud_config_dir()?;
    let active_config = fs::read_to_string(config_dir.join("active_config"))
        .ok()
        .and_then(|value| clean_optional(&value))
        .unwrap_or_else(|| "default".to_string());
    let config = fs::read_to_string(
        config_dir
            .join("configurations")
            .join(format!("config_{active_config}")),
    )
    .ok()?;

    parse_gcloud_project(&config)
}

fn parse_gcloud_project(config: &str) -> Option<String> {
    config.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        if name.trim() == "project" {
            clean_optional(value)
        } else {
            None
        }
    })
}

fn speech_endpoint(project_id: &str, location: &str) -> String {
    let host = if location == "global" {
        "speech.googleapis.com".to_string()
    } else {
        format!("{location}-speech.googleapis.com")
    };
    format!("https://{host}/v2/projects/{project_id}/locations/{location}/recognizers/_:recognize")
}

fn explicit_audio_encoding(mime_type: Option<&str>) -> Option<&'static str> {
    let lower = mime_type?.to_ascii_lowercase();
    if lower.contains("webm") {
        return Some("WEBM_OPUS");
    }
    if lower.contains("ogg") || lower.contains("opus") {
        return Some("OGG_OPUS");
    }
    None
}

fn first_non_empty<const N: usize>(values: [Option<&str>; N]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn clean_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn clean_required(value: &str, label: &str) -> Result<String, String> {
    clean_optional(value).ok_or_else(|| format!("Missing {label}."))
}

fn normalize_chirp_model(value: &str) -> Result<String, String> {
    match value.trim() {
        "chirp_3" => Ok("chirp_3".to_string()),
        "chirp_2" => Ok("chirp_2".to_string()),
        other => Err(format!(
            "Unsupported Speech-to-Text model '{other}'. Use chirp_3 or chirp_2."
        )),
    }
}

fn env_value(name: &str) -> Option<String> {
    env::var(name).ok().and_then(|value| clean_optional(&value))
}

fn env_or_embedded_value(name: &str, embedded: Option<&'static str>) -> Option<String> {
    env_value(name).or_else(|| embedded.and_then(clean_optional))
}

fn format_upstream_error(error: UpstreamError) -> String {
    if error.status == 0 {
        return format!("Speech-to-Text failed: {}", error.body);
    }
    format!("Speech-to-Text failed ({}): {}", error.status, error.body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_authorized_user_adc() {
        let raw = r#"{
            "type": "authorized_user",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "refresh_token": "refresh-token",
            "quota_project_id": "quota-project"
        }"#;

        let credentials = parse_google_credentials(raw).expect("authorized-user ADC should parse");
        assert!(matches!(credentials, GoogleCredentials::AuthorizedUser(_)));
        assert_eq!(credentials.quota_project_id(), Some("quota-project"));
    }

    #[test]
    fn parses_service_account_credentials() {
        let raw = r#"{
            "type": "service_account",
            "private_key": "private-key",
            "client_email": "voice@example.test",
            "project_id": "speech-project"
        }"#;

        let credentials = parse_google_credentials(raw).expect("service account should parse");
        assert!(matches!(credentials, GoogleCredentials::ServiceAccount(_)));
        assert_eq!(credentials.project_id(), Some("speech-project"));
    }

    #[test]
    fn reads_project_from_gcloud_configuration() {
        let config = "[core]\naccount = person@example.test\nproject = speech-project\n";
        assert_eq!(
            parse_gcloud_project(config).as_deref(),
            Some("speech-project")
        );
    }

    #[test]
    fn uses_chirp3_automatic_language_detection() {
        let configured = vec![
            "en-US".to_string(),
            "am-ET".to_string(),
            "en-US".to_string(),
            "fr-FR".to_string(),
            "es-ES".to_string(),
        ];
        assert_eq!(
            resolve_language_codes(Some(&configured), "en-US", "chirp_3"),
            vec!["auto"]
        );
    }

    #[test]
    fn adds_the_personal_transcription_prompt() {
        let features = recognition_features(Some("Preserve English and Amharic."));
        assert_eq!(features["enableWordTimeOffsets"], true);
        assert_eq!(
            features["customPromptConfig"]["customPrompt"],
            "Preserve English and Amharic."
        );
    }

    #[test]
    fn parses_word_time_offsets_across_recognition_results() {
        let response = r#"{
            "results": [
                {"alternatives": [{
                    "transcript": "Hello world.",
                    "words": [
                        {"word": "Hello", "startOffset": "0.120s", "endOffset": "0.510s"},
                        {"word": "world.", "startOffset": "0.550s", "endOffset": "1.04s"}
                    ]
                }]},
                {"alternatives": [{
                    "transcript": "Again.",
                    "words": [
                        {"word": "Again.", "startOffset": {"seconds": "2", "nanos": 250000000}, "endOffset": "2.8s"}
                    ]
                }]}
            ]
        }"#;

        let parsed = parse_transcription(response).expect("response should parse");
        assert_eq!(parsed.transcript, "Hello world. Again.");
        assert_eq!(
            parsed.words,
            vec![
                ChirpTranscribedWord {
                    text: "Hello".into(),
                    start_ms: 120,
                    end_ms: 510
                },
                ChirpTranscribedWord {
                    text: "world.".into(),
                    start_ms: 550,
                    end_ms: 1_040
                },
                ChirpTranscribedWord {
                    text: "Again.".into(),
                    start_ms: 2_250,
                    end_ms: 2_800
                },
            ]
        );
    }
}
