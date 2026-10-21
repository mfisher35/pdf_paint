use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// PDFs the OS asked us to open ("Open with", double-clicking an associated file).
#[derive(Default)]
struct OpenedFiles {
  /// Paths the frontend hasn't taken yet.
  pending: Mutex<Vec<PathBuf>>,
  /// Every path the OS handed us. `read_opened_file` only reads these.
  allowed: Mutex<HashSet<PathBuf>>,
}

/// Queues files the OS passed in and tells the frontend to come and take them. The frontend
/// may not be listening yet (cold start), so it also takes them once at startup.
fn file_opened(app: &AppHandle, paths: Vec<PathBuf>) {
  let state = app.state::<OpenedFiles>();
  for path in paths {
    state.allowed.lock().unwrap().insert(path.clone());
    state.pending.lock().unwrap().push(path);
  }
  let _ = app.emit("file-opened", ());
}

/// On Windows and Linux the file comes in as a command-line argument.
fn paths_from_args() -> Vec<PathBuf> {
  std::env::args_os()
    .skip(1)
    .map(PathBuf::from)
    .filter(|p| p.is_file())
    .collect()
}

/// Returns (and clears) the files waiting to be opened.
#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
  state
    .pending
    .lock()
    .unwrap()
    .drain(..)
    .map(|p| p.to_string_lossy().to_string())
    .collect()
}

/// Reads a file the OS asked us to open, as raw bytes.
#[tauri::command]
fn read_opened_file(path: String, state: tauri::State<OpenedFiles>) -> Result<tauri::ipc::Response, String> {
  let path = PathBuf::from(path);
  if !state.allowed.lock().unwrap().contains(&path) {
    return Err("That file was not opened from the system.".into());
  }
  std::fs::read(&path)
    .map(tauri::ipc::Response::new)
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(OpenedFiles::default())
    .invoke_handler(tauri::generate_handler![take_opened_files, read_opened_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      file_opened(app.handle(), paths_from_args());
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // On macOS the file comes in as an Apple Event instead of an argument, both at launch
      // and when the app is already running.
      #[cfg(any(target_os = "macos", target_os = "ios"))]
      {
        if let tauri::RunEvent::Opened { urls } = _event {
          let paths = urls.into_iter().filter_map(|u| u.to_file_path().ok()).collect();
          file_opened(_app, paths);
        }
      }
    });
}
