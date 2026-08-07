use serde_json::Value;
use std::time::Duration;

const MAX_SWITCHBOARD_RESPONSE_BYTES: usize = 1024 * 1024;

#[tauri::command]
pub async fn submit_switchboard_intent(
    endpoint: String,
    envelope: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("The Switchboard URL is empty.".to_string());
    }

    let timeout = timeout_ms.unwrap_or(15_000).clamp(1_000, 60_000);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|error| format!("Could not configure Switchboard transport: {error}"))?;
    let response = client
        .post(endpoint)
        .json(&envelope)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Switchboard handoff timed out.".to_string()
            } else {
                format!("Could not reach Switchboard: {error}")
            }
        })?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Switchboard returned an invalid response: {error}"))?;

    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Switchboard rejected the handoff ({status})."));
        return Err(message);
    }

    if body
        .get("admission")
        .and_then(|admission| admission.get("id"))
        .and_then(Value::as_str)
        .is_none()
    {
        return Err("Switchboard returned an invalid admission response.".to_string());
    }

    Ok(body)
}

#[tauri::command]
pub async fn fetch_switchboard_tasks(
    endpoint: String,
    message_id: String,
    expected_raw_intent_id: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("The Switchboard URL is empty.".to_string());
    }

    let message_id = message_id.trim();
    if message_id.is_empty() {
        return Err("The Switchboard message ID is empty.".to_string());
    }

    let expected_raw_intent_id = expected_raw_intent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let timeout = timeout_ms.unwrap_or(15_000).clamp(1_000, 60_000);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|error| format!("Could not configure Switchboard transport: {error}"))?;
    let mut response = client
        .get(endpoint)
        .query(&[("message_id", message_id), ("limit", "1")])
        .send()
        .await
        .map_err(switchboard_task_transport_error)?;
    let status = response.status();

    if response
        .content_length()
        .is_some_and(|length| length > MAX_SWITCHBOARD_RESPONSE_BYTES as u64)
    {
        return Err("Switchboard task response exceeded the 1 MiB limit.".to_string());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(switchboard_task_transport_error)?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_SWITCHBOARD_RESPONSE_BYTES {
            return Err("Switchboard task response exceeded the 1 MiB limit.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Switchboard returned an invalid task response: {error}"))?;
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Switchboard rejected the task lookup ({status})."));
        return Err(message);
    }

    let tasks = body
        .get("tasks")
        .and_then(Value::as_array)
        .ok_or_else(|| "Switchboard returned an invalid task response.".to_string())?;
    if tasks.len() > 1 {
        return Err("Switchboard returned more than one task for this message.".to_string());
    }

    if let Some(task) = tasks.first() {
        let actual_message_id = task.get("messageId").and_then(Value::as_str);
        if actual_message_id != Some(message_id) {
            return Err("Switchboard task does not match this admission (messageId).".to_string());
        }

        if let Some(expected_raw_intent_id) = expected_raw_intent_id {
            let actual_task_id = task.get("taskId").and_then(Value::as_str);
            if actual_task_id != Some(expected_raw_intent_id) {
                return Err("Switchboard task does not match this admission (taskId).".to_string());
            }
        }
    }

    Ok(body)
}

fn switchboard_task_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Switchboard task lookup timed out.".to_string()
    } else {
        format!("Could not reach Switchboard: {error}")
    }
}

#[cfg(test)]
mod tests {
    use super::{fetch_switchboard_tasks, submit_switchboard_intent};
    use serde_json::{json, Value};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    struct CapturedRequest {
        request_line: String,
        body: Vec<u8>,
    }

    fn read_request(stream: &mut TcpStream) -> CapturedRequest {
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .expect("set request read timeout");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let header_end = loop {
            let count = stream.read(&mut buffer).expect("read request");
            assert!(count > 0, "connection closed before request headers");
            request.extend_from_slice(&buffer[..count]);
            if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };

        let headers = std::str::from_utf8(&request[..header_end])
            .expect("UTF-8 request headers")
            .to_owned();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length").then(|| {
                    value
                        .trim()
                        .parse::<usize>()
                        .expect("numeric content length")
                })
            })
            .unwrap_or(0);
        while request.len() - header_end < content_length {
            let count = stream.read(&mut buffer).expect("read request body");
            assert!(count > 0, "connection closed before request body");
            request.extend_from_slice(&buffer[..count]);
        }

        CapturedRequest {
            request_line: headers.lines().next().expect("request line").to_string(),
            body: request[header_end..header_end + content_length].to_vec(),
        }
    }

    fn write_json_response(stream: &mut TcpStream, status: &str, body: &Value) {
        let body = serde_json::to_vec(body).expect("serialize response body");
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .expect("write response headers");
        stream.write_all(&body).expect("write response body");
    }

    fn serve_once_at(
        path: &str,
        responder: impl FnOnce(&mut TcpStream, &CapturedRequest) + Send + 'static,
    ) -> (
        String,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback listener");
        let endpoint = format!(
            "http://{}{}",
            listener.local_addr().expect("listener address"),
            path
        );
        let (request_tx, request_rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let request = read_request(&mut stream);
            responder(&mut stream, &request);
            request_tx.send(request).expect("capture request");
        });
        (endpoint, request_rx, handle)
    }

    fn serve_once(
        responder: impl FnOnce(&mut TcpStream, &CapturedRequest) + Send + 'static,
    ) -> (
        String,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        serve_once_at("/api/v1/external-intents", responder)
    }

    fn serve_task_once(
        responder: impl FnOnce(&mut TcpStream, &CapturedRequest) + Send + 'static,
    ) -> (
        String,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        serve_once_at("/api/v1/tasks", responder)
    }

    fn execute_envelope() -> Value {
        json!({
            "contract_version": 1,
            "source_system": "branch-continue",
            "source_record_id": "qnuid-branch-42",
            "source_hash": "sha256:0123456789abcdef",
            "exact_text": "Ship it\n\nBuild the explicit integration.",
            "evidence_refs": [],
            "context_refs": [{
                "type": "branch-continue-lineage",
                "source_path": "/isolated/fixture/quicknote.org",
                "parent_note_id": "qnuid-parent-7"
            }],
            "project_hint": "branch-continue",
            "authority": "execute",
            "idempotency_key": "branch-continue:qnuid-branch-42:sha256:0123456789abcdef"
        })
    }

    #[test]
    fn posts_the_exact_envelope_and_returns_the_bound_admission() {
        let envelope = execute_envelope();
        let expected_body = serde_json::to_vec(&envelope).expect("serialize expected envelope");
        let admission = json!({
            "admission": {
                "id": "admission-1",
                "sourceSystem": "branch-continue",
                "sourceRecordId": "qnuid-branch-42",
                "sourceHash": "sha256:0123456789abcdef",
                "authority": "execute",
                "idempotencyKey": "branch-continue:qnuid-branch-42:sha256:0123456789abcdef",
                "state": "queued"
            }
        });
        let response_body = admission.clone();
        let (endpoint, request_rx, server) = serve_once(move |stream, _| {
            write_json_response(stream, "202 Accepted", &response_body);
        });

        let response = tauri::async_runtime::block_on(submit_switchboard_intent(
            endpoint,
            envelope,
            Some(2_000),
        ))
        .expect("accept bound admission");
        let request = request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(
            request.request_line,
            "POST /api/v1/external-intents HTTP/1.1"
        );
        assert_eq!(request.body, expected_body);
        assert_eq!(response, admission);
    }

    #[test]
    fn reports_switchboard_rejection_message() {
        let (endpoint, request_rx, server) = serve_once(|stream, _| {
            write_json_response(
                stream,
                "409 Conflict",
                &json!({"error": "revision already superseded"}),
            );
        });

        let error = tauri::async_runtime::block_on(submit_switchboard_intent(
            endpoint,
            execute_envelope(),
            Some(2_000),
        ))
        .expect_err("reject non-success response");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "revision already superseded");
    }

    #[test]
    fn rejects_success_without_an_admission_id() {
        let (endpoint, request_rx, server) = serve_once(|stream, _| {
            write_json_response(stream, "200 OK", &json!({"admission": {"state": "queued"}}));
        });

        let error = tauri::async_runtime::block_on(submit_switchboard_intent(
            endpoint,
            execute_envelope(),
            Some(2_000),
        ))
        .expect_err("reject unbound success response");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "Switchboard returned an invalid admission response.");
    }

    #[test]
    fn times_out_when_switchboard_does_not_respond() {
        let (endpoint, request_rx, server) = serve_once(|_, _| {
            thread::sleep(Duration::from_millis(1_200));
        });

        let error = tauri::async_runtime::block_on(submit_switchboard_intent(
            endpoint,
            execute_envelope(),
            Some(1_000),
        ))
        .expect_err("time out stalled response");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "Switchboard handoff timed out.");
    }

    #[test]
    fn gets_one_task_with_an_encoded_message_id_and_limit() {
        let response_body = json!({
            "tasks": [{
                "taskId": "raw-intent-1",
                "messageId": "message 1/+",
                "status": "running"
            }]
        });
        let expected = response_body.clone();
        let (endpoint, request_rx, server) = serve_task_once(move |stream, _| {
            write_json_response(stream, "200 OK", &response_body);
        });

        let response = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message 1/+".to_string(),
            Some("raw-intent-1".to_string()),
            Some(2_000),
        ))
        .expect("return one matching task");
        let request = request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(
            request.request_line,
            "GET /api/v1/tasks?message_id=message+1%2F%2B&limit=1 HTTP/1.1"
        );
        assert!(request.body.is_empty());
        assert_eq!(response, expected);
    }

    #[test]
    fn accepts_an_empty_task_projection() {
        let (endpoint, request_rx, server) = serve_task_once(|stream, _| {
            write_json_response(stream, "200 OK", &json!({"tasks": []}));
        });

        let response = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            Some("raw-intent-1".to_string()),
            Some(2_000),
        ))
        .expect("accept no task yet");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(response, json!({"tasks": []}));
    }

    #[test]
    fn rejects_a_task_for_another_message() {
        let (endpoint, request_rx, server) = serve_task_once(|stream, _| {
            write_json_response(
                stream,
                "200 OK",
                &json!({"tasks": [{"taskId": "raw-intent-1", "messageId": "other"}]}),
            );
        });

        let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            Some("raw-intent-1".to_string()),
            Some(2_000),
        ))
        .expect_err("reject mismatched message");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(
            error,
            "Switchboard task does not match this admission (messageId)."
        );
    }

    #[test]
    fn rejects_a_task_for_another_raw_intent() {
        let (endpoint, request_rx, server) = serve_task_once(|stream, _| {
            write_json_response(
                stream,
                "200 OK",
                &json!({"tasks": [{"taskId": "other", "messageId": "message-1"}]}),
            );
        });

        let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            Some("raw-intent-1".to_string()),
            Some(2_000),
        ))
        .expect_err("reject mismatched raw intent");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(
            error,
            "Switchboard task does not match this admission (taskId)."
        );
    }

    #[test]
    fn rejects_a_malformed_or_ambiguous_task_projection() {
        for response_body in [
            json!({"tasks": {}}),
            json!({"tasks": [
                {"taskId": "raw-intent-1", "messageId": "message-1"},
                {"taskId": "raw-intent-2", "messageId": "message-1"}
            ]}),
        ] {
            let (endpoint, request_rx, server) = serve_task_once(move |stream, _| {
                write_json_response(stream, "200 OK", &response_body);
            });

            let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
                endpoint,
                "message-1".to_string(),
                Some("raw-intent-1".to_string()),
                Some(2_000),
            ))
            .expect_err("reject malformed projection");
            request_rx
                .recv_timeout(Duration::from_secs(3))
                .expect("captured request");
            server.join().expect("loopback server");

            assert!(error.starts_with("Switchboard returned"));
        }
    }

    #[test]
    fn reports_switchboard_task_lookup_rejection_message() {
        let (endpoint, request_rx, server) = serve_task_once(|stream, _| {
            write_json_response(
                stream,
                "503 Service Unavailable",
                &json!({"error": "projection is rebuilding"}),
            );
        });

        let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            None,
            Some(2_000),
        ))
        .expect_err("report Switchboard error");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "projection is rebuilding");
    }

    #[test]
    fn task_lookup_times_out_when_switchboard_does_not_respond() {
        let (endpoint, request_rx, server) = serve_task_once(|_, _| {
            thread::sleep(Duration::from_millis(1_200));
        });

        let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            None,
            Some(1_000),
        ))
        .expect_err("time out stalled task lookup");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "Switchboard task lookup timed out.");
    }

    #[test]
    fn rejects_an_oversized_task_projection() {
        let oversized = vec![b' '; super::MAX_SWITCHBOARD_RESPONSE_BYTES + 1];
        let (endpoint, request_rx, server) = serve_task_once(move |stream, _| {
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                oversized.len()
            )
            .expect("write response headers");
        });

        let error = tauri::async_runtime::block_on(fetch_switchboard_tasks(
            endpoint,
            "message-1".to_string(),
            None,
            Some(2_000),
        ))
        .expect_err("reject oversized response");
        request_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("captured request");
        server.join().expect("loopback server");

        assert_eq!(error, "Switchboard task response exceeded the 1 MiB limit.");
    }
}
