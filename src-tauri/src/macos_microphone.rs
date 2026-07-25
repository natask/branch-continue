//! macOS microphone access.
//!
//! WKWebView itself is not the blocker here: wry already answers
//! `webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:`
//! with `WKPermissionDecisionGrant`, so the web layer never prompts. The prompt the
//! user sees is the system TCC one, raised by the WebKit GPU process the first time
//! `getUserMedia` runs — i.e. in the middle of the user's first recording.
//!
//! Asking for the grant here, at the app level, moves that prompt to launch, shows it
//! with our own `NSMicrophoneUsageDescription`, and leaves the status `authorized` by
//! the time `getUserMedia` runs.

use block2::RcBlock;
use objc2::runtime::{AnyClass, Bool};
use objc2::{msg_send, ffi::NSInteger};
use objc2_foundation::NSString;

/// `AVMediaTypeAudio`. The constant is the four-char code, stable since 10.7.
const MEDIA_TYPE_AUDIO: &str = "soun";

/// `AVAuthorizationStatus`.
const STATUS_NOT_DETERMINED: NSInteger = 0;
const STATUS_RESTRICTED: NSInteger = 1;
const STATUS_DENIED: NSInteger = 2;
const STATUS_AUTHORIZED: NSInteger = 3;

/// The current TCC state for this app, as a string the web layer can match on with the
/// same vocabulary as the Permissions API.
pub fn authorization_state() -> &'static str {
    match authorization_status() {
        Some(STATUS_AUTHORIZED) => "granted",
        Some(STATUS_DENIED) | Some(STATUS_RESTRICTED) => "denied",
        Some(STATUS_NOT_DETERMINED) => "prompt",
        _ => "unknown",
    }
}

/// Raise the system microphone prompt if this app has never been asked about.
///
/// Does nothing once the user has answered, in either direction: a denied grant can
/// only be reversed in System Settings, and re-asking would not surface a prompt.
pub fn request_access_if_undetermined() {
    match authorization_status() {
        Some(STATUS_NOT_DETERMINED) => request_access(),
        Some(STATUS_DENIED) | Some(STATUS_RESTRICTED) => {
            log::warn!(
                "Microphone access is denied for this app. Recording will fail until it is \
                 re-enabled in System Settings > Privacy & Security > Microphone."
            );
        }
        Some(STATUS_AUTHORIZED) => {}
        _ => log::warn!("Could not read the microphone authorization status."),
    }
}

fn capture_device_class() -> Option<&'static AnyClass> {
    AnyClass::get(c"AVCaptureDevice")
}

fn authorization_status() -> Option<NSInteger> {
    let class = capture_device_class()?;
    let media_type = NSString::from_str(MEDIA_TYPE_AUDIO);
    // SAFETY: `+[AVCaptureDevice authorizationStatusForMediaType:]` takes an
    // AVMediaType (an NSString) and returns an AVAuthorizationStatus (NSInteger).
    Some(unsafe { msg_send![class, authorizationStatusForMediaType: &*media_type] })
}

fn request_access() {
    let Some(class) = capture_device_class() else {
        return;
    };
    let media_type = NSString::from_str(MEDIA_TYPE_AUDIO);
    let completion = RcBlock::new(|granted: Bool| {
        if granted.as_bool() {
            log::info!("Microphone access granted.");
        } else {
            log::warn!("Microphone access was declined.");
        }
    });

    // SAFETY: `+[AVCaptureDevice requestAccessForMediaType:completionHandler:]` takes an
    // AVMediaType and a `void (^)(BOOL)`. It returns immediately; the block runs on an
    // arbitrary queue once the user answers.
    unsafe {
        let _: () = msg_send![
            class,
            requestAccessForMediaType: &*media_type,
            completionHandler: &*completion,
        ];
    }
}
