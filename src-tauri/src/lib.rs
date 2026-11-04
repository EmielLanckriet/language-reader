//! Reader's native shell (ADR-0047): the bundled web app, plus the database file it cannot keep in
//! browser storage. The page loads the file through the `readerdb` URL scheme once per storage
//! worker, and sends each finished transaction to `db_commit` as base64 parts, in order. Not raw
//! invoke bodies: on Android every invoke travels as JSON.

mod store;

use std::sync::Mutex;
use tauri::http;
use tauri::Manager;

struct Database {
    store: Mutex<Option<store::Store>>,
    /// The parts of the batch being received, appended as one record when the last arrives.
    pending: Mutex<Vec<u8>>,
}

fn with_store<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut store::Store) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<Database>();
    let mut guard = state.store.lock().map_err(|_| "database lock poisoned".to_string())?;
    if guard.is_none() {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        *guard = Some(store::Store::open(&dir)?);
    }
    f(guard.as_mut().unwrap())
}

#[tauri::command]
async fn db_commit(app: tauri::AppHandle, part: String, last: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = store::decode_base64(&part)?;
        let state = app.state::<Database>();
        let mut pending = state.pending.lock().map_err(|_| "pending lock poisoned".to_string())?;
        pending.extend_from_slice(&bytes);
        if !last {
            return Ok(());
        }
        let batch = std::mem::take(&mut *pending);
        drop(pending);
        with_store(&app, |s| s.append(&batch))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Database { store: Mutex::new(None), pending: Mutex::new(Vec::new()) })
        .register_asynchronous_uri_scheme_protocol("readerdb", |ctx, _request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                // A load starts a fresh worker: parts of a batch an earlier one left are void.
                if let Ok(mut pending) = app.state::<Database>().pending.lock() {
                    pending.clear();
                }
                let (status, body) = match with_store(&app, |s| s.load()) {
                    Ok(bytes) => (200, bytes),
                    Err(e) => (500, e.into_bytes()),
                };
                responder.respond(
                    http::Response::builder()
                        .status(status)
                        .header("Content-Type", "application/octet-stream")
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cross-Origin-Resource-Policy", "cross-origin")
                        .body(body)
                        .unwrap(),
                );
            });
        })
        .invoke_handler(tauri::generate_handler![db_commit])
        .run(tauri::generate_context!())
        .expect("error while running Reader");
}
