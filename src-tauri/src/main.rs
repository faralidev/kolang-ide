// kolang-ide — Tauri backend (Rust).
//
// پورت‌شده از main.js الکترون. تمام دستورات IPC الکترون به‌صورت Tauri commands
// بازنویسی شده‌اند: اجرای مفسر کلنگ، لینتر، دیالوگهای فایل، تنظیمات.
//
// مفسر کلنگ و لینتر به‌صورت زیرپروسه اجرا می‌شوند — دقیقاً مثل نسخهٔ الکترون.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

// ---------------------------------------------------------------------------
// انواع داده‌های مشترک
// ---------------------------------------------------------------------------

/// نتیجهٔ اجرای برنامهٔ کلنگ.
#[derive(Serialize)]
struct RunResult {
    stdout: String,
    stderr: String,
    #[serde(rename = "exitCode")]
    exit_code: i32,
    #[serde(rename = "durationMs")]
    duration_ms: f64,
}

/// یک تشخیص لینتر.
#[derive(Serialize, Deserialize)]
struct Diagnostic {
    line: i64,
    col: i64,
    #[serde(rename = "endLine")]
    end_line: i64,
    #[serde(rename = "endCol")]
    end_col: i64,
    severity: String,
    message: String,
    rule: String,
}

/// تنظیمات ذخیره‌شدهٔ کاربر.
#[derive(Serialize, Deserialize, Clone)]
struct Settings {
    #[serde(rename = "kolangPath")]
    kolang_path: String,
    #[serde(rename = "linterPath")]
    linter_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            kolang_path: resolve_default_kolang_bin(),
            linter_path: resolve_default_linter_bin(),
        }
    }
}

/// یک ورودی پوشه/فایل در فایل‌اکسپلورر.
#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

#[derive(Serialize)]
struct ListDirResult {
    entries: Vec<DirEntry>,
}

#[derive(Serialize)]
struct OpenFileResult {
    path: String,
    content: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct SaveFileResult {
    path: Option<String>,
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// حالت برنامه (managed state)
// ---------------------------------------------------------------------------

struct AppState {
    running_child: Mutex<Option<Child>>,
    settings: Mutex<Settings>,
}

// ---------------------------------------------------------------------------
// رزولو مسیر باینری مفسر و لینتر
// ---------------------------------------------------------------------------

fn resolve_default_kolang_bin() -> String {
    if let Ok(p) = std::env::var("KOLANG_BIN") {
        return p;
    }
    // در حالت بسته‌بندی‌شده، باینری در resources/bin/ قرار دارد.
    // در حالت توسعه، kolang باید روی PATH باشد.
    "kolang".to_string()
}

fn resolve_default_linter_bin() -> String {
    if let Ok(p) = std::env::var("KOLANG_LINTER") {
        return p;
    }
    "kolang-linter".to_string()
}

fn resource_bin(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok()?;
    let bin = res.join("bin").join(name);
    if bin.exists() {
        Some(bin)
    } else {
        None
    }
}

fn current_kolang_path(app: &AppHandle, settings: &Settings) -> String {
    let s = settings.kolang_path.trim();
    if !s.is_empty() && s != "kolang" {
        return s.to_string();
    }
    // تلاش برای پیدا کردن باینری بسته‌بندی‌شده
    let name = if cfg!(windows) { "kolang.exe" } else { "kolang" };
    if let Some(p) = resource_bin(app, name) {
        return p.to_string_lossy().to_string();
    }
    "kolang".to_string()
}

fn current_linter_path(app: &AppHandle, settings: &Settings) -> String {
    let s = settings.linter_path.trim();
    if !s.is_empty() && s != "kolang-linter" {
        return s.to_string();
    }
    let name = if cfg!(windows) {
        "kolang-linter.exe"
    } else {
        "kolang-linter"
    };
    if let Some(p) = resource_bin(app, name) {
        return p.to_string_lossy().to_string();
    }
    "kolang-linter".to_string()
}

// ---------------------------------------------------------------------------
// مسیر فایل تنظیمات
// ---------------------------------------------------------------------------

fn settings_file_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    let path = match settings_file_path(app) {
        Some(p) => p,
        None => return Settings::default(),
    };
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    if let Some(path) = settings_file_path(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, serde_json::to_string_pretty(settings).unwrap_or_default());
    }
}

// ---------------------------------------------------------------------------
// دستورات Tauri
// ---------------------------------------------------------------------------

/// اجرای کد کلنگ با مفسر (نوشتن در فایل موقت + spawn).
#[tauri::command]
fn kolang_run(
    app: AppHandle,
    state: State<AppState>,
    code: String,
) -> RunResult {
    let settings = state.settings.lock().unwrap().clone();
    let kolang_bin = current_kolang_path(&app, &settings);

    // نوشتن کد در فایل موقت
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("kolang-ide-{}.kolang", chrono_timestamp()));
    if let Err(e) = fs::write(&temp_file, &code) {
        return RunResult {
            stdout: String::new(),
            stderr: format!("Failed to write temp file: {}", e),
            exit_code: -1,
            duration_ms: 0.0,
        };
    }

    // بررسی وجود و قابل‌اجرا بودن باینری
    let bin_path = PathBuf::from(&kolang_bin);
    if !bin_path.exists() && kolang_bin != "kolang" && kolang_bin != "kolang.exe" {
        let _ = fs::remove_file(&temp_file);
        return RunResult {
            stdout: String::new(),
            stderr: format!(
                "«مسیر مفسر کلنگ پیدا نشد: {} — لطفاً در تنظیمات مسیر را تنظیم کنید»",
                kolang_bin
            ),
            exit_code: -1,
            duration_ms: 0.0,
        };
    }

    let started = Instant::now();
    let mut command = Command::new(&kolang_bin);
    command
        .arg(&temp_file)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = fs::remove_file(&temp_file);
            return RunResult {
                stdout: String::new(),
                stderr: format!("Failed to start kolang: {}", e),
                exit_code: -1,
                duration_ms: 0.0,
            };
        }
    };

    // ثبت زیرپروسه برای دکمهٔ توقف
    {
        let mut running = state.running_child.lock().unwrap();
        *running = Some(child);
    }

    // Timeout: 10 ثانیه
    let timeout = Duration::from_millis(10_000);
    let start = Instant::now();

    // خواندن stdout + stderr با timeout
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = -1;
    let mut timed_out = false;

    // گرفتن child برای مدیریت
    let mut child_opt = {
        let mut running = state.running_child.lock().unwrap();
        running.take()
    };

    if let Some(ref mut child) = child_opt {
        // خواندن stdout
        if let Some(mut out) = child.stdout.take() {
            use std::io::Read;
            let _ = out.read_to_string(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            use std::io::Read;
            let _ = err.read_to_string(&mut stderr);
        }

        // انتظار برای پایان با timeout
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    exit_code = status.code().unwrap_or(-1);
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > timeout {
                        timed_out = true;
                        let _ = child.kill();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    }

    let duration_ms = started.elapsed().as_millis() as f64;

    if timed_out {
        stderr = format!(
            "{}\n[kolang-ide] اجرا بیش از ۱۰ ثانیه طول کشید و متوقف شد.",
            stderr
        );
    }

    let _ = fs::remove_file(&temp_file);

    RunResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
    }
}

/// توقف برنامهٔ در حال اجرا.
#[tauri::command]
fn kolang_kill(state: State<AppState>) -> bool {
    let mut running = state.running_child.lock().unwrap();
    if let Some(mut child) = running.take() {
        let _ = child.kill();
        return true;
    }
    false
}

/// اجرای لینتر روی کد (stdin → JSON diagnostics).
#[tauri::command]
fn linter_run(app: AppHandle, state: State<AppState>, code: String) -> Vec<Diagnostic> {
    let settings = state.settings.lock().unwrap().clone();
    let linter_bin = current_linter_path(&app, &settings);

    let mut child = match Command::new(&linter_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    use std::io::Write;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(code.as_bytes());
    }

    // Timeout: 5 ثانیه
    let start = Instant::now();
    let timeout = Duration::from_millis(5_000);

    let mut output = String::new();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return vec![];
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return vec![],
        }
    }

    if let Some(mut out) = child.stdout.take() {
        use std::io::Read;
        let _ = out.read_to_string(&mut output);
    }

    // تجزیهٔ JSON: { "diagnostics": [...] }
    #[derive(Deserialize)]
    struct LinterOutput {
        diagnostics: Option<Vec<Diagnostic>>,
    }
    let parsed: Result<LinterOutput, _> = serde_json::from_str(&output);
    parsed.map(|p| p.diagnostics.unwrap_or_default()).unwrap_or_default()
}

/// دیالوگ باز کردن فایل .kolang.
#[tauri::command]
fn file_open(app: AppHandle) -> Option<OpenFileResult> {
    let result = app
        .dialog()
        .file()
        .set_title("باز کردن فایل کلنگ")
        .add_filter("Kolang", &["kolang"])
        .blocking_pick_file();

    let path = result?.into_path().ok()?;
    match fs::read_to_string(&path) {
        Ok(content) => Some(OpenFileResult {
            path: path.to_string_lossy().to_string(),
            content: Some(content),
            error: None,
        }),
        Err(e) => Some(OpenFileResult {
            path: path.to_string_lossy().to_string(),
            content: None,
            error: Some(e.to_string()),
        }),
    }
}

/// دیالوگ ذخیرهٔ فایل .kolang.
#[tauri::command]
fn file_save(app: AppHandle, content: String) -> Option<SaveFileResult> {
    let result = app
        .dialog()
        .file()
        .set_title("ذخیره فایل کلنگ")
        .add_filter("Kolang", &["kolang"])
        .set_file_name("untitled.kolang")
        .blocking_save_file();

    let path = result?.into_path().ok()?;
    match fs::write(&path, &content) {
        Ok(_) => Some(SaveFileResult {
            path: Some(path.to_string_lossy().to_string()),
            error: None,
        }),
        Err(e) => Some(SaveFileResult {
            path: Some(path.to_string_lossy().to_string()),
            error: Some(e.to_string()),
        }),
    }
}

/// فهرست کردن محتویات یک پوشه (پوشه‌ها اول، بعد فایل‌ها، الفبایی).
#[tauri::command]
fn fs_list_dir(dir_path: String) -> ListDirResult {
    match fs::read_dir(&dir_path) {
        Ok(entries) => {
            let mut items: Vec<DirEntry> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || name == "node_modules" {
                        return None;
                    }
                    let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    Some(DirEntry {
                        path: e.path().to_string_lossy().to_string(),
                        name,
                        is_dir,
                    })
                })
                .collect();
            items.sort_by(|a, b| {
                if a.is_dir != b.is_dir {
                    return if a.is_dir {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    };
                }
                a.name.cmp(&b.name)
            });
            ListDirResult { entries: items }
        }
        Err(e) => ListDirResult { entries: vec![] },
    }
}

/// دیالوگ انتخاب پوشه.
#[tauri::command]
fn fs_open_folder(app: AppHandle) -> Option<String> {
    let result = app
        .dialog()
        .file()
        .set_title("باز کردن پوشه")
        .blocking_pick_folder()?;
    Some(result.into_path().ok()?.to_string_lossy().to_string())
}

/// خواندن فایل از مسیر.
#[tauri::command]
fn fs_read_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

/// نوشتن فایل در مسیر.
#[tauri::command]
fn fs_write_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, &content).map_err(|e| e.to_string())
}

/// خواندن تنظیمات ذخیره‌شده.
#[tauri::command]
fn settings_get(app: AppHandle, state: State<AppState>) -> Settings {
    let s = state.settings.lock().unwrap().clone();
    // اگر تنظیمات خالی است، از فایل بارگذاری کن
    if s.kolang_path.is_empty() {
        load_settings(&app)
    } else {
        s
    }
}

/// ذخیرهٔ تنظیمات.
#[tauri::command]
fn settings_set(app: AppHandle, state: State<AppState>, settings: Settings) -> bool {
    let next = Settings {
        kolang_path: if settings.kolang_path.trim().is_empty() {
            resolve_default_kolang_bin()
        } else {
            settings.kolang_path.trim().to_string()
        },
        linter_path: if settings.linter_path.trim().is_empty() {
            resolve_default_linter_bin()
        } else {
            settings.linter_path.trim().to_string()
        },
    };
    save_settings(&app, &next);
    let mut current = state.settings.lock().unwrap();
    *current = next;
    true
}

/// دیالوگ انتخاب مسیر مفسر.
#[tauri::command]
fn settings_pick_path(app: AppHandle) -> Option<String> {
    let result = app
        .dialog()
        .file()
        .set_title("انتخاب مفسر کلنگ")
        .blocking_pick_file()?;
    Some(result.into_path().ok()?.to_string_lossy().to_string())
}

/// دیالوگ انتخاب مسیر لینتر.
#[tauri::command]
fn settings_pick_linter_path(app: AppHandle) -> Option<String> {
    let result = app
        .dialog()
        .file()
        .set_title("انتخاب لینتر کلنگ")
        .blocking_pick_file()?;
    Some(result.into_path().ok()?.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// ابزار
// ---------------------------------------------------------------------------

fn chrono_timestamp() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = load_settings(app.handle());
            app.manage(AppState {
                running_child: Mutex::new(None),
                settings: Mutex::new(settings),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kolang_run,
            kolang_kill,
            linter_run,
            file_open,
            file_save,
            fs_list_dir,
            fs_open_folder,
            fs_read_file,
            fs_write_file,
            settings_get,
            settings_set,
            settings_pick_path,
            settings_pick_linter_path,
        ])
        .run(tauri::generate_context!())
        .expect("خطا در اجرای kolang-ide");
}
