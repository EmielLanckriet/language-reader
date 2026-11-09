//! Reader's native shell (ADR-0047): the bundled web app, plus the database file it cannot keep in
//! browser storage. The page loads the file through the `readerdb` URL scheme once per storage
//! worker, and sends each finished transaction to `db_commit` as base64 parts, in order. Not raw
//! invoke bodies: on Android every invoke travels as JSON. Media lives beside it (media.rs).

mod media;
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

fn library(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("library"))
}

fn in_library(app: &tauri::AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    media::resolve(&library(app)?, path)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// One base64 part of a file; `first` starts it, `last` moves it into place.
#[tauri::command]
async fn media_write(
    app: tauri::AppHandle,
    path: String,
    part: String,
    first: bool,
    last: bool,
) -> Result<(), String> {
    blocking(move || {
        media::write_part(&in_library(&app, &path)?, &store::decode_base64(&part)?, first, last)
    })
    .await
}

#[tauri::command]
async fn media_remove(app: tauri::AppHandle, path: String) -> Result<(), String> {
    blocking(move || media::remove(&in_library(&app, &path)?)).await
}

#[tauri::command]
async fn media_move(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    blocking(move || media::rename(&in_library(&app, &from)?, &in_library(&app, &to)?)).await
}

#[tauri::command]
async fn media_link(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    blocking(move || media::link(&in_library(&app, &from)?, &in_library(&app, &to)?)).await
}

/// A Termux bundle downloaded and unpacked into `dir`; its files.
#[tauri::command]
async fn media_take_bundle(
    app: tauri::AppHandle,
    url: String,
    dir: String,
) -> Result<Vec<media::Entry>, String> {
    blocking(move || media::take_bundle(&url, &in_library(&app, &dir)?)).await
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
        .register_asynchronous_uri_scheme_protocol("readermedia", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let range = request.headers().get("range").and_then(|v| v.to_str().ok());
                let reply = match library(&app) {
                    Ok(root) => media::serve(&root, request.method().as_str(), request.uri().path(), range),
                    Err(e) => media::Reply { status: 500, headers: vec![], body: e.into_bytes() },
                };
                let mut response = http::Response::builder()
                    .status(reply.status)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Headers", "Range")
                    .header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
                    .header("Cross-Origin-Resource-Policy", "cross-origin");
                for (name, value) in reply.headers {
                    response = response.header(name, value);
                }
                responder.respond(response.body(reply.body).unwrap());
            });
        })
        .invoke_handler(tauri::generate_handler![
            db_commit,
            media_write,
            media_remove,
            media_move,
            media_link,
            media_take_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reader");
}
