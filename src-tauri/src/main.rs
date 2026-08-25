#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
const APP_DATA_DIR: &str = "Todo Sticky";
const STATE_FILE: &str = "state.json";
const ATTACHMENT_INDEX_FILE: &str = "attachments.json";
const BACKUP_DIR: &str = "backups";
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone)]
struct AttachmentMeta {
    id: String,
    file_name: String,
    mime_type: Option<String>,
    path: String,
}

#[derive(Serialize)]
struct AttachmentPayload {
    meta: AttachmentMeta,
    bytes: Vec<u8>,
}

#[tauri::command]
fn load_app_state() -> Result<Option<String>, String> {
    let path = state_path()?;
    let mut previous_path = path.clone();
    previous_path.set_extension("json.previous");
    if !path.exists() {
        return if previous_path.exists() {
            read_valid_json_file(&previous_path).map(Some)
        } else {
            Ok(None)
        };
    }
    match read_valid_json_file(&path) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            if previous_path.exists() {
                read_valid_json_file(&previous_path).map(Some)
            } else {
                read_valid_json_file(&path).map(Some)
            }
        }
    }
}

fn read_valid_json_file(path: &PathBuf) -> Result<String, String> {
    let value = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str::<serde_json::Value>(&value).map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
fn save_app_state(value: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&value).map_err(|error| error.to_string())?;
    let path = state_path()?;
    let mut temp_path = path.clone();
    temp_path.set_extension("json.tmp");
    let mut previous_path = path.clone();
    previous_path.set_extension("json.previous");
    fs::write(&temp_path, value).map_err(|error| error.to_string())?;
    if path.exists() {
        let _ = fs::copy(&path, &previous_path);
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, &path).map_err(|error| error.to_string())
}

#[tauri::command]
fn backup_app_state(reason: Option<String>, value: String) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&value).map_err(|error| error.to_string())?;
    let mut path = app_data_dir()?;
    path.push(BACKUP_DIR);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let reason = safe_file_id(reason.as_deref().unwrap_or("state"));
    path.push(format!("state-{}-{}.json", stamp, reason));
    fs::write(&path, value).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_attachment(
    id: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    bytes: Vec<u8>,
) -> Result<AttachmentMeta, String> {
    if id.trim().is_empty() {
        return Err("attachment id is empty".into());
    }
    if bytes.is_empty() {
        return Err("attachment data is empty".into());
    }
    let file_name = file_name.unwrap_or_else(|| format!("{}.png", id));
    let extension = file_name
        .rsplit('.')
        .next()
        .filter(|part| part.len() <= 5 && *part != file_name)
        .map(|part| part.to_string())
        .or_else(|| mime_type.as_deref().and_then(extension_for_mime))
        .unwrap_or_else(|| "png".to_string());
    let mut path = attachments_dir()?;
    path.push(format!("{}.{}", safe_file_id(&id), extension));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;

    let meta = AttachmentMeta {
        id,
        file_name,
        mime_type,
        path: path.to_string_lossy().to_string(),
    };
    upsert_attachment_meta(meta.clone())?;
    Ok(meta)
}

#[tauri::command]
fn list_attachments() -> Result<Vec<AttachmentMeta>, String> {
    Ok(read_attachment_index()?
        .into_iter()
        .filter(|item| PathBuf::from(&item.path).exists())
        .collect())
}

#[tauri::command]
fn read_attachment(id: String) -> Result<Option<AttachmentPayload>, String> {
    let Some(meta) = read_attachment_index()?
        .into_iter()
        .find(|item| item.id == id)
    else {
        return Ok(None);
    };
    let path = PathBuf::from(&meta.path);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Some(AttachmentPayload { meta, bytes }))
}

#[tauri::command]
fn open_stored_attachment(id: String) -> Result<bool, String> {
    let Some(meta) = read_attachment_index()?
        .into_iter()
        .find(|item| item.id == id)
    else {
        return Ok(false);
    };
    let path = PathBuf::from(meta.path);
    if !path.exists() {
        return Ok(false);
    }
    open_with_system_viewer(&path)?;
    Ok(true)
}

fn state_path() -> Result<PathBuf, String> {
    let mut path = app_data_dir()?;
    path.push(STATE_FILE);
    Ok(path)
}

fn attachments_dir() -> Result<PathBuf, String> {
    let mut path = app_data_dir()?;
    path.push("attachments");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn attachment_index_path() -> Result<PathBuf, String> {
    let mut path = app_data_dir()?;
    path.push(ATTACHMENT_INDEX_FILE);
    Ok(path)
}

fn app_data_dir() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA")
        .or_else(|| env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or(env::current_dir().map_err(|error| error.to_string())?);
    let mut path = base;
    path.push(APP_DATA_DIR);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn read_attachment_index() -> Result<Vec<AttachmentMeta>, String> {
    let path = attachment_index_path()?;
    let mut previous_path = path.clone();
    previous_path.set_extension("json.previous");
    if !path.exists() {
        return if previous_path.exists() {
            read_attachment_index_file(&previous_path)
        } else {
            Ok(Vec::new())
        };
    }
    read_attachment_index_file(&path).or_else(|_| read_attachment_index_file(&previous_path))
}

fn read_attachment_index_file(path: &PathBuf) -> Result<Vec<AttachmentMeta>, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn upsert_attachment_meta(meta: AttachmentMeta) -> Result<(), String> {
    let mut items = read_attachment_index()?;
    if let Some(existing) = items.iter_mut().find(|item| item.id == meta.id) {
        *existing = meta;
    } else {
        items.push(meta);
    }
    let path = attachment_index_path()?;
    let text = serde_json::to_string_pretty(&items).map_err(|error| error.to_string())?;
    let mut temp_path = path.clone();
    temp_path.set_extension("json.tmp");
    let mut previous_path = path.clone();
    previous_path.set_extension("json.previous");
    fs::write(&temp_path, text).map_err(|error| error.to_string())?;
    if path.exists() {
        let _ = fs::copy(&path, &previous_path);
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, &path).map_err(|error| error.to_string())
}

fn safe_file_id(id: &str) -> String {
    id.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[tauri::command]
fn set_always_on_top(window: tauri::Window, always_on_top: bool) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_dragging(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_width(window: tauri::Window, width: f64) -> Result<f64, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let previous_width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|error| error.to_string())?;
    Ok(previous_width)
}

#[tauri::command]
fn open_image_viewer(
    file_name: String,
    mime_type: Option<String>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("image data is empty".into());
    }
    let temp_path = write_temp_image(&file_name, mime_type.as_deref(), &bytes)?;
    open_with_system_viewer(&temp_path)?;
    Ok(())
}

fn write_temp_image(
    file_name: &str,
    mime_type: Option<&str>,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let mut path = env::temp_dir();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let extension = file_name
        .rsplit('.')
        .next()
        .filter(|part| part.len() <= 5 && *part != file_name)
        .map(|part| part.to_string())
        .or_else(|| mime_type.and_then(extension_for_mime))
        .unwrap_or_else(|| "png".to_string());
    path.push(format!(
        "daibanshixiang-image-{}-{}.{}",
        stamp,
        std::process::id(),
        extension
    ));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

fn extension_for_mime(mime: &str) -> Option<String> {
    match mime {
        "image/png" => Some("png".into()),
        "image/jpeg" => Some("jpg".into()),
        "image/jpg" => Some("jpg".into()),
        "image/gif" => Some("gif".into()),
        "image/webp" => Some("webp".into()),
        "image/bmp" => Some("bmp".into()),
        "image/tiff" => Some("tiff".into()),
        _ => None,
    }
}

fn open_with_system_viewer(path: &PathBuf) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_always_on_top,
            start_dragging,
            minimize,
            close,
            set_window_width,
            load_app_state,
            save_app_state,
            backup_app_state,
            save_attachment,
            list_attachments,
            read_attachment,
            open_stored_attachment,
            open_image_viewer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
