// The Rust side is deliberately thin: it holds the SQLite file open, runs SQL
// handed to it by the interface (every batch in ONE transaction), makes backup
// copies, and reads/writes the files the user picks. All accounting rules live
// in TypeScript (src/domain), where they are tested against the Excel workbook.

use base64::Engine;
use rusqlite::{types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState {
    conn: Mutex<Option<Connection>>,
    path: Mutex<Option<PathBuf>>,
}

#[derive(Deserialize)]
struct Stmt {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> Value {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Value::Null,
        Integer(i) => Value::Number(i.into()),
        Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        Blob(_) => Value::Null,
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn with_conn<T>(state: &State<DbState>, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = state.conn.lock().map_err(err)?;
    let conn = guard.as_mut().ok_or("No database is open")?;
    f(conn)
}

/// Opens (or creates) the database file the user chose.
#[tauri::command]
fn db_open(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = Connection::open(&path).map_err(err)?;
    // DELETE journal keeps the database as ONE file: easy to copy and to back up.
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;")
        .map_err(err)?;
    *state.conn.lock().map_err(err)? = Some(conn);
    *state.path.lock().map_err(err)? = Some(PathBuf::from(path));
    Ok(())
}

#[tauri::command]
fn db_close(state: State<DbState>) -> Result<(), String> {
    *state.conn.lock().map_err(err)? = None;
    *state.path.lock().map_err(err)? = None;
    Ok(())
}

#[tauri::command]
fn db_query(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(&sql).map_err(err)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(p.iter())).map_err(err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err)? {
            let mut m = Map::new();
            for (i, n) in names.iter().enumerate() {
                m.insert(n.clone(), from_sql(row.get_ref(i).map_err(err)?));
            }
            out.push(m);
        }
        Ok(out)
    })
}

/// All statements succeed together or none is written.
#[tauri::command]
fn db_batch(state: State<DbState>, stmts: Vec<Stmt>) -> Result<(), String> {
    with_conn(&state, |conn| {
        let tx = conn.transaction().map_err(err)?;
        for s in &stmts {
            let p: Vec<SqlValue> = s.params.iter().map(to_sql).collect();
            tx.execute(&s.sql, rusqlite::params_from_iter(p.iter()))
                .map_err(|e| format!("{e}\nSQL: {}", s.sql))?;
        }
        tx.commit().map_err(err)
    })
}

/// A consistent copy of the open database (SQLite VACUUM INTO).
#[tauri::command]
fn db_backup(state: State<DbState>, dest: String) -> Result<(), String> {
    if Path::new(&dest).exists() {
        fs::remove_file(&dest).map_err(err)?;
    }
    if let Some(dir) = Path::new(&dest).parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    with_conn(&state, |conn| conn.execute("VACUUM INTO ?1", [&dest]).map(|_| ()).map_err(err))
}

/// Replaces the open database by a backup copy. A safety copy of the current
/// file is taken first, so a restore can itself be undone.
#[tauri::command]
fn db_restore(state: State<DbState>, from: String, safety_copy: String) -> Result<(), String> {
    let path = state.path.lock().map_err(err)?.clone().ok_or("No database is open")?;
    with_conn(&state, |conn| conn.execute("VACUUM INTO ?1", [&safety_copy]).map(|_| ()).map_err(err))?;
    *state.conn.lock().map_err(err)? = None;
    fs::copy(&from, &path).map_err(err)?;
    let conn = Connection::open(&path).map_err(err)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;")
        .map_err(err)?;
    *state.conn.lock().map_err(err)? = Some(conn);
    Ok(())
}

#[tauri::command]
fn file_read(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn file_write_b64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(err)?;
    if let Some(dir) = Path::new(&path).parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(&path, bytes).map_err(err)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Files in a folder (name, size, modified time in ms), newest first.
#[tauri::command]
fn dir_list(path: String) -> Result<Vec<Map<String, Value>>, String> {
    let mut out = Vec::new();
    let rd = match fs::read_dir(&path) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for e in rd.flatten() {
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !md.is_file() {
            continue;
        }
        let modified = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut m = Map::new();
        m.insert("name".into(), Value::String(e.file_name().to_string_lossy().into_owned()));
        m.insert("path".into(), Value::String(e.path().to_string_lossy().into_owned()));
        m.insert("size".into(), Value::Number(md.len().into()));
        m.insert("modified".into(), Value::Number(modified.into()));
        out.push(m);
    }
    out.sort_by(|a, b| b["modified"].as_u64().cmp(&a["modified"].as_u64()));
    Ok(out)
}

#[tauri::command]
fn file_delete(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(err)
}

/// Small settings of this computer (which database file to open), kept outside the database.
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn config_get(app: tauri::AppHandle) -> Result<Value, String> {
    let p = config_path(&app)?;
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map_err(err),
        Err(_) => Ok(Value::Object(Map::new())),
    }
}

#[tauri::command]
fn config_set(app: tauri::AppHandle, value: Value) -> Result<(), String> {
    let p = config_path(&app)?;
    fs::write(&p, serde_json::to_string_pretty(&value).map_err(err)?).map_err(err)
}

#[tauri::command]
fn documents_dir(app: tauri::AppHandle) -> Result<String, String> {
    let d = app.path().document_dir().map_err(err)?;
    Ok(d.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState { conn: Mutex::new(None), path: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            db_open, db_close, db_query, db_batch, db_backup, db_restore,
            file_read, file_write_b64, file_exists, dir_list, file_delete,
            config_get, config_set, documents_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
