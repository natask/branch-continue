use serde_json::Value;
use std::time::Duration;

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

#[cfg(test)]
mod tests {
    use super::submit_switchboard_intent;
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
            .expect("content-length header");
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

    fn serve_once(
        responder: impl FnOnce(&mut TcpStream, &CapturedRequest) + Send + 'static,
    ) -> (
        String,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback listener");
        let endpoint = format!(
            "http://{}/api/v1/external-intents",
            listener.local_addr().expect("listener address")
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
}
