use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
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
}

#[derive(Debug, Deserialize)]
struct ServiceAccountKey {
    private_key: String,
    private_key_id: Option<String>,
    client_email: String,
    project_id: Option<String>,
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
    let service_account_raw =
        load_service_account_key(payload.service_account_key_path.as_deref())?;
    let service_account = parse_service_account_key(&service_account_raw)?;
    let env_project_id =
        env_or_embedded_value("BRANCH_CONTINUE_GCP_PROJECT_ID", EMBEDDED_GCP_PROJECT_ID);
    let env_project_id_fallback =
        env_or_embedded_value("GCP_PROJECT_ID", EMBEDDED_LEGACY_GCP_PROJECT_ID);
    let env_location = env_or_embedded_value("BRANCH_CONTINUE_GCP_LOCATION", EMBEDDED_GCP_LOCATION);
    let env_location_fallback = env_or_embedded_value("GCP_LOCATION", EMBEDDED_LEGACY_GCP_LOCATION);
    let env_model = env_or_embedded_value("BRANCH_CONTINUE_CHIRP_MODEL", EMBEDDED_CHIRP_MODEL);
    let env_model_fallback = env_or_embedded_value("CHIRP_MODEL", EMBEDDED_LEGACY_CHIRP_MODEL);
    let project_id = first_non_empty([
        payload.project_id.as_deref(),
        env_project_id.as_deref(),
        env_project_id_fallback.as_deref(),
        service_account.project_id.as_deref(),
    ])
    .ok_or_else(|| "Missing GCP project id.".to_string())?;
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

    let client = reqwest::Client::new();
    let access_token = get_access_token(&client, &service_account).await?;
    let endpoint = speech_endpoint(&project_id, &location);
    let features = json!({ "enableAutomaticPunctuation": true });
    let explicit_encoding = explicit_audio_encoding(payload.mime_type.as_deref());
    let body = match explicit_encoding {
        Some(encoding) => json!({
            "config": {
                "explicitDecodingConfig": {
                    "encoding": encoding,
                    "sampleRateHertz": 48000,
                    "audioChannelCount": 1
                },
                "languageCodes": [language_code],
                "model": model,
                "features": features
            },
            "content": audio_base64
        }),
        None => auto_decoding_body(audio_base64, &language_code, &model, features.clone()),
    };

    let response_text = match post_recognize(&client, &endpoint, &access_token, body).await {
        Ok(text) => text,
        Err(err) if err.status == 400 && explicit_encoding.is_some() => {
            let fallback = auto_decoding_body(audio_base64, &language_code, &model, features);
            post_recognize(&client, &endpoint, &access_token, fallback)
                .await
                .map_err(format_upstream_error)?
        }
        Err(err) => return Err(format_upstream_error(err)),
    };
    let transcript = parse_transcript(&response_text)?;

    Ok(ChirpTranscribeResponse { transcript })
}

async fn get_access_token(
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

async fn post_recognize(
    client: &reqwest::Client,
    endpoint: &str,
    access_token: &str,
    body: Value,
) -> Result<String, UpstreamError> {
    let response = client
        .post(endpoint)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|error| UpstreamError {
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
    language_code: &str,
    model: &str,
    features: Value,
) -> Value {
    json!({
        "config": {
            "autoDecodingConfig": {},
            "languageCodes": [language_code],
            "model": model,
            "features": features
        },
        "content": audio_base64
    })
}

fn parse_transcript(response_text: &str) -> Result<String, String> {
    let data: Value = serde_json::from_str(response_text)
        .map_err(|error| format!("Invalid Speech-to-Text response: {error}"))?;
    let Some(results) = data.get("results").and_then(Value::as_array) else {
        return Ok("(no speech detected)".to_string());
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

    if transcript.is_empty() {
        Ok("(no speech detected)".to_string())
    } else {
        Ok(transcript)
    }
}

fn load_service_account_key(path: Option<&str>) -> Result<String, String> {
    if let Some(clean_path) = path.and_then(clean_optional) {
        return fs::read_to_string(&clean_path)
            .map_err(|error| format!("Failed to read GCP service account key path: {error}"));
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

    Err("Missing GCP service account key. Build with BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY, set GCP_SERVICE_ACCOUNT_KEY, set GOOGLE_APPLICATION_CREDENTIALS, choose the fallback key path in recording config, or add the dev-only bundled key file before packaging.".to_string())
}

fn parse_service_account_key(raw: &str) -> Result<ServiceAccountKey, String> {
    serde_json::from_str(raw.trim())
        .or_else(|_| serde_json::from_str(&raw.replace('\n', "\\n")))
        .map_err(|error| format!("Invalid GCP service account key JSON: {error}"))
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

fn first_non_empty(values: [Option<&str>; 4]) -> Option<String> {
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
