// kolang-ide — Tauri backend (Rust).
//
// پورت‌شده از main.js الکترون. تمام دستورات IPC الکترون به‌صورت Tauri commands
// بازنویسی شده‌اند: اجرای مفسر کلنگ، لینتر، دیالوگهای فایل، تنظیمات.
//
// مفسر کلنگ و لینتر به‌صورت زیرپروسه اجرا می‌شوند — دقیقاً مثل نسخهٔ الکترون.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as AsyncMutex;

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
    error: Option<String>,
}

/// نتیجهٔ خواندن فایل.
#[derive(Serialize)]
struct FsReadResult {
    content: Option<String>,
    error: Option<String>,
}

/// نتیجهٔ نوشتن فایل.
#[derive(Serialize)]
struct FsWriteResult {
    ok: bool,
    error: Option<String>,
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
    running_child: Arc<AsyncMutex<Option<Child>>>,
    settings: Mutex<Settings>,
}

// ---------------------------------------------------------------------------
// وضعیت دانلود باینری‌ها (مدیریت‌شده، قابل اشتراک با نخ پس‌زمینه)
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct DownloadState {
    kolang_ready: Arc<AtomicBool>,
    linter_ready: Arc<AtomicBool>,
    downloading: Arc<AtomicBool>,
    kolang_path: Arc<Mutex<String>>,
    linter_path: Arc<Mutex<String>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        DownloadState {
            kolang_ready: Arc::new(AtomicBool::new(false)),
            linter_ready: Arc::new(AtomicBool::new(false)),
            downloading: Arc::new(AtomicBool::new(false)),
            kolang_path: Arc::new(Mutex::new(String::new())),
            linter_path: Arc::new(Mutex::new(String::new())),
        }
    }
}

/// نتیجهٔ get_binary_status برای نمایش وضعیت دانلود در UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryStatus {
    kolang_ready: bool,
    linter_ready: bool,
    kolang_path: String,
    linter_path: String,
    downloading: bool,
}

// ---------------------------------------------------------------------------
// رزولو مسیر باینری مفسر و لینتر
// ---------------------------------------------------------------------------

/// نام فایل باینری با در نظر گرفتن پسوند exe در ویندوز.
fn binary_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

/// باینری کش‌شده در app_data_dir/bin (دانلودشده در اولین اجرا).
fn cached_bin(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let app_data = app.path().app_data_dir().ok()?;
    let p = app_data.join("bin").join(binary_name(name));
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// تنظیمات پیش‌فرض با رزولوشن باینری‌ها (باینری کش‌شده، سپس PATH).
fn default_settings(app: &AppHandle) -> Settings {
    Settings {
        kolang_path: resolve_default_kolang_bin(app),
        linter_path: resolve_default_linter_bin(app),
    }
}

fn resolve_default_kolang_bin(app: &AppHandle) -> String {
    if let Ok(p) = std::env::var("KOLANG_BIN") {
        return p;
    }
    // اولویت با باینری دانلودشده در اولین اجرا است.
    if let Some(p) = cached_bin(app, "kolang") {
        return p.to_string_lossy().to_string();
    }
    // در حالت بسته‌بندی‌شده، باینری در resources/bin/ قرار دارد.
    let name = if cfg!(windows) { "kolang.exe" } else { "kolang" };
    if let Some(p) = resource_bin(app, name) {
        return p.to_string_lossy().to_string();
    }
    // در حالت توسعه، bin/kolang نسبت به ریشهٔ پروژه.
    // current_dir ممکن است src-tauri/ باشد، پس تا ریشه بالا می‌رویم.
    if let Some(p) = find_dev_bin("kolang") {
        return p.to_string_lossy().to_string();
    }
    "kolang".to_string()
}

fn resolve_default_linter_bin(app: &AppHandle) -> String {
    if let Ok(p) = std::env::var("KOLANG_LINTER") {
        return p;
    }
    if let Some(p) = cached_bin(app, "kolang-linter") {
        return p.to_string_lossy().to_string();
    }
    let name = if cfg!(windows) {
        "kolang-linter.exe"
    } else {
        "kolang-linter"
    };
    if let Some(p) = resource_bin(app, name) {
        return p.to_string_lossy().to_string();
    }
    if let Some(p) = find_dev_bin("kolang-linter") {
        return p.to_string_lossy().to_string();
    }
    "kolang-linter".to_string()
}

/// در حالت توسعه، باینری‌ها در bin/ نسبت به ریشهٔ پروژه قرار دارند.
/// current_dir ممکن است src-tauri/ یا ریشه باشد؛ تا ۳ سطح بالا می‌رویم.
fn find_dev_bin(name: &str) -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    for _ in 0..4 {
        let candidate = dir.join("bin").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
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
    if !s.is_empty() && s != "kolang" && s != "kolang.exe" {
        return s.to_string();
    }
    // باینری کش‌شده، سپس بسته‌بندی‌شده، سپس PATH.
    resolve_default_kolang_bin(app)
}

fn current_linter_path(app: &AppHandle, settings: &Settings) -> String {
    let s = settings.linter_path.trim();
    if !s.is_empty() && s != "kolang-linter" && s != "kolang-linter.exe" {
        return s.to_string();
    }
    resolve_default_linter_bin(app)
}

// ---------------------------------------------------------------------------
// دانلود باینری‌های کلنگ و لینتر در اولین اجرا
// ---------------------------------------------------------------------------

/// تشخیص os/arch برای URL انتشار: darwin/linux/windows + arm64/amd64.
fn target_spec() -> Option<(String, String, &'static str)> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        _ => return None,
    };
    let ext = if os == "windows" { "zip" } else { "tar.gz" };
    Some((os.to_string(), arch.to_string(), ext))
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut perm = metadata.permissions();
            perm.set_mode(perm.mode() | 0o111);
            let _ = fs::set_permissions(path, perm);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// استخراج باینری از آرشیو tar.gz (فایل تکی با نام `name`).
fn extract_tar_gz(archive_path: &Path, bin_dir: &Path, name: &str) -> Option<PathBuf> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = fs::File::open(archive_path).ok()?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let exe_name = binary_name(name);

    let mut entries = archive.entries().ok()?;
    while let Some(entry) = entries.next() {
        let mut entry = entry.ok()?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let entry_path = entry.path().ok()?.into_owned();
        let fname = entry_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if fname == exe_name || fname == name {
            let dest = bin_dir.join(&exe_name);
            let mut out = fs::File::create(&dest).ok()?;
            std::io::copy(&mut entry, &mut out).ok()?;
            return Some(dest);
        }
    }
    None
}

/// استخراج باینری از آرشیو zip (مخصوص ویندوز).
fn extract_zip(archive_path: &Path, bin_dir: &Path, name: &str) -> Option<PathBuf> {
    let file = fs::File::open(archive_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let exe_name = binary_name(name);

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).ok()?;
        if entry.is_dir() {
            continue;
        }
        let fname = Path::new(entry.name())
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if fname == exe_name || fname == name {
            let dest = bin_dir.join(&exe_name);
            let mut out = fs::File::create(&dest).ok()?;
            std::io::copy(&mut entry, &mut out).ok()?;
            return Some(dest);
        }
    }
    None
}

/// اطمینان از وجود باینری: اگر در app_data_dir/bin نباشد، از GitHub دانلود می‌شود.
/// در صورت موفقیت مسیر باینری و در غیر این صورت None برمی‌گرداند (فال‌بک به PATH).
fn ensure_binary(app: &AppHandle, name: &str, repo: &str) -> Option<PathBuf> {
    let app_data = app.path().app_data_dir().ok()?;
    let bin_dir = app_data.join("bin");
    fs::create_dir_all(&bin_dir).ok()?;

    let dest = bin_dir.join(binary_name(name));
    if dest.exists() {
        return Some(dest);
    }

    let (os, arch, ext) = target_spec()?;
    let url = format!(
        "https://github.com/faralidev/{repo}/releases/latest/download/{name}-{os}-{arch}.{ext}"
    );
    eprintln!("[kolang-ide] Downloading {} from {}", name, url);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .ok()?;
    let response = client.get(&url).send().ok()?;
    if !response.status().is_success() {
        eprintln!(
            "[kolang-ide] Download of {} failed with status {}",
            name,
            response.status()
        );
        return None;
    }
    let bytes = response.bytes().ok()?;

    let tmp = bin_dir.join(format!("{}.download.{}", name, ext));
    fs::write(&tmp, &bytes).ok()?;

    let extracted = match ext {
        "zip" => extract_zip(&tmp, &bin_dir, name),
        _ => extract_tar_gz(&tmp, &bin_dir, name),
    };
    let _ = fs::remove_file(&tmp);
    let dest = extracted?;

    make_executable(&dest);
    eprintln!("[kolang-ide] Installed {} at {}", name, dest.display());
    Some(dest)
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
        None => return default_settings(app),
    };
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_settings(app)),
        Err(_) => default_settings(app),
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
///
/// Asynchronous تا UI فریز نشود: خروجی stdout/stderr به‌صورت هم‌زمان خوانده
/// می‌شود و اگر اجرا بیش از ۱۰ ثانیه طول بکشد، زیرپروسه متوقف می‌شود.
#[tauri::command]
async fn kolang_run(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> Result<RunResult, String> {
    let settings = state.settings.lock().unwrap().clone();
    let kolang_bin = current_kolang_path(&app, &settings);

    // نوشتن کد در فایل موقت
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("kolang-ide-{}.kolang", system_timestamp()));
    if let Err(e) = fs::write(&temp_file, &code) {
        return Ok(RunResult {
            stdout: String::new(),
            stderr: format!("Failed to write temp file: {}", e),
            exit_code: -1,
            duration_ms: 0.0,
        });
    }

    // بررسی وجود باینری. اگر نام پیش‌فرض ("kolang") تنظیم شده و روی PATH
    // نیست، پیام فارسی دوستانه برگردانده می‌شود.
    let is_default_name = kolang_bin == "kolang" || kolang_bin == "kolang.exe";
    if !PathBuf::from(&kolang_bin).exists() {
        let _ = fs::remove_file(&temp_file);
        return Ok(RunResult {
            stdout: String::new(),
            stderr: if is_default_name {
                "«مفسر کلنگ روی PATH پیدا نشد — لطفاً در تنظیمات مسیر مفسر را تنظیم کنید»"
                    .to_string()
            } else {
                format!(
                    "«مسیر مفسر کلنگ پیدا نشد: {} — لطفاً در تنظیمات مسیر را تنظیم کنید»",
                    kolang_bin
                )
            },
            exit_code: -1,
            duration_ms: 0.0,
        });
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
            return Ok(RunResult {
                stdout: String::new(),
                stderr: format!("Failed to start kolang: {}", e),
                exit_code: -1,
                duration_ms: 0.0,
            });
        }
    };

    // جدا کردن stdout/stderr و ثبت زیرپروسه در state تا دکمهٔ توقف بتواند
    // در هر لحظه آن را بکشد. زیرپروسه تا پایان اجرا داخل state می‌ماند.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    {
        let mut running = state.running_child.lock().await;
        *running = Some(child);
    }

    // خواندن هم‌زمان stdout و stderr — هرگز ترتیبی (ریسک deadlock روی pipe).
    let read_stdout = async {
        let mut out = String::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_string(&mut out).await;
        }
        out
    };
    let read_stderr = async {
        let mut err = String::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_string(&mut err).await;
        }
        err
    };

    // انتظار برای پایان زیرپروسه با timeout (۱۰ ثانیه). زیرپروسه داخل state
    // باقی می‌ماند تا kolang_kill بتواند هر لحظه آن را متوقف کند. با timeout
    // زیرپروسه کشته شده و zombie آن جمع‌آوری می‌شود.
    let wait_for_exit = async {
        let mut exit_code = -1;
        let mut timed_out = false;
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let exited = {
                let mut running = state.running_child.lock().await;
                match running.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => {
                            exit_code = status.code().unwrap_or(-1);
                            true
                        }
                        Ok(None) => false,
                        Err(_) => true,
                    },
                    None => true, // kolang_kill زیرپروسه را حذف کرده
                }
            };
            if exited {
                break;
            }
            if Instant::now() > deadline {
                timed_out = true;
                let mut running = state.running_child.lock().await;
                if let Some(mut child) = running.take() {
                    let _ = child.kill().await;
                    let _ = child.wait().await; // جمع‌آوری zombie
                }
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        (exit_code, timed_out)
    };

    let (stdout, stderr, (exit_code, timed_out)) = tokio::join!(
        read_stdout,
        read_stderr,
        wait_for_exit,
    );

    // حذف زیرپروسه از state پس از پایان اجرا.
    {
        let mut running = state.running_child.lock().await;
        if let Some(mut child) = running.take() {
            let _ = child.wait().await;
        }
    }

    let duration_ms = started.elapsed().as_millis() as f64;

    let stderr = if timed_out {
        format!(
            "{}\n[kolang-ide] اجرا بیش از ۱۰ ثانیه طول کشید و متوقف شد.",
            stderr
        )
    } else {
        stderr
    };

    let _ = fs::remove_file(&temp_file);

    Ok(RunResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
    })
}

/// توقف برنامهٔ در حال اجرا.
#[tauri::command]
async fn kolang_kill(state: State<'_, AppState>) -> Result<bool, String> {
    let mut running = state.running_child.lock().await;
    if let Some(mut child) = running.take() {
        let _ = child.kill().await;
        let _ = child.wait().await; // جمع‌آوری zombie
        return Ok(true);
    }
    Ok(false)
}

/// اجرای لینتر روی کد (stdin → JSON diagnostics).
///
/// Asynchronous: کد از طریق stdin ارسال می‌شود، stdout هم‌زمان با انتظار
/// برای پایان خوانده می‌شود و اگر بیش از ۵ ثانیه طول بکشد، لینتر متوقف می‌شود.
#[tauri::command]
async fn linter_run(app: AppHandle, state: State<'_, AppState>, code: String) -> Result<Vec<Diagnostic>, String> {
    let settings = state.settings.lock().unwrap().clone();
    let linter_bin = current_linter_path(&app, &settings);

    let mut child = match Command::new(&linter_bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return Ok(vec![]),
    };

    // ارسال کد از طریق stdin و بستن آن (EOF) تا لینتر پایان ورودی را بفهمد
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(code.as_bytes()).await;
        drop(stdin);
    }

    // خواندن stdout به‌صورت هم‌زمان با انتظار برای پایان (timeout: ۵ ثانیه)
    let stdout_pipe = child.stdout.take();
    let read_stdout = async {
        let mut output = String::new();
        if let Some(mut pipe) = stdout_pipe {
            let _ = pipe.read_to_string(&mut output).await;
        }
        output
    };

    let (output, timed_out) = tokio::join!(
        read_stdout,
        async {
            tokio::time::timeout(Duration::from_secs(5), child.wait())
                .await
                .is_err()
        },
    );

    if timed_out {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Ok(vec![]);
    }

    // تجزیهٔ JSON: { "diagnostics": [...] }
    #[derive(Deserialize)]
    struct LinterOutput {
        diagnostics: Option<Vec<Diagnostic>>,
    }
    let parsed: Result<LinterOutput, _> = serde_json::from_str(&output);
    Ok(parsed.map(|p| p.diagnostics.unwrap_or_default()).unwrap_or_default())
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
            ListDirResult {
                entries: items,
                error: None,
            }
        }
        Err(e) => ListDirResult {
            entries: vec![],
            error: Some(e.to_string()),
        },
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
fn fs_read_file(file_path: String) -> FsReadResult {
    match fs::read_to_string(&file_path) {
        Ok(content) => FsReadResult {
            content: Some(content),
            error: None,
        },
        Err(e) => FsReadResult {
            content: None,
            error: Some(e.to_string()),
        },
    }
}

/// نوشتن فایل در مسیر.
#[tauri::command]
fn fs_write_file(file_path: String, content: String) -> FsWriteResult {
    match fs::write(&file_path, &content) {
        Ok(_) => FsWriteResult {
            ok: true,
            error: None,
        },
        Err(e) => FsWriteResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

/// خواندن تنظیمات ذخیره‌شده.
#[tauri::command]
fn settings_get(_app: AppHandle, state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

/// ذخیرهٔ تنظیمات.
#[tauri::command]
fn settings_set(app: AppHandle, state: State<AppState>, settings: Settings) -> bool {
    let next = Settings {
        kolang_path: if settings.kolang_path.trim().is_empty() {
            resolve_default_kolang_bin(&app)
        } else {
            settings.kolang_path.trim().to_string()
        },
        linter_path: if settings.linter_path.trim().is_empty() {
            resolve_default_linter_bin(&app)
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

/// وضعیت باینری‌های دانلودشده (برای نمایش پیشرفت دانلود در UI).
#[tauri::command]
fn get_binary_status(state: State<DownloadState>) -> BinaryStatus {
    BinaryStatus {
        kolang_ready: state.kolang_ready.load(Ordering::Relaxed),
        linter_ready: state.linter_ready.load(Ordering::Relaxed),
        kolang_path: state.kolang_path.lock().unwrap().clone(),
        linter_path: state.linter_path.lock().unwrap().clone(),
        downloading: state.downloading.load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// ابزار
// ---------------------------------------------------------------------------

fn system_timestamp() -> u128 {
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
                running_child: Arc::new(AsyncMutex::new(None)),
                settings: Mutex::new(settings),
            });

            // وضعیت دانلود باینری‌ها (در نخ پس‌زمینه به‌روزرسانی می‌شود).
            let dl = DownloadState::default();
            {
                *dl.kolang_path.lock().unwrap() = resolve_default_kolang_bin(app.handle());
                *dl.linter_path.lock().unwrap() = resolve_default_linter_bin(app.handle());
                dl.kolang_ready
                    .store(cached_bin(app.handle(), "kolang").is_some(), Ordering::Relaxed);
                dl.linter_ready.store(
                    cached_bin(app.handle(), "kolang-linter").is_some(),
                    Ordering::Relaxed,
                );
            }
            app.manage(dl.clone());

            // دانلود غیرمسدودکنندهٔ باینری‌ها تا UI فریز نشود.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                dl.downloading.store(true, Ordering::Relaxed);

                if let Some(p) = ensure_binary(&handle, "kolang", "kolang") {
                    dl.kolang_ready.store(true, Ordering::Relaxed);
                    *dl.kolang_path.lock().unwrap() = p.to_string_lossy().to_string();
                    if let Some(state) = handle.try_state::<AppState>() {
                        let mut s = state.settings.lock().unwrap();
                        if s.kolang_path.trim().is_empty() || s.kolang_path == "kolang" {
                            s.kolang_path = p.to_string_lossy().to_string();
                            save_settings(&handle, &s);
                        }
                    }
                }

                if let Some(p) = ensure_binary(&handle, "kolang-linter", "kolang-linter") {
                    dl.linter_ready.store(true, Ordering::Relaxed);
                    *dl.linter_path.lock().unwrap() = p.to_string_lossy().to_string();
                    if let Some(state) = handle.try_state::<AppState>() {
                        let mut s = state.settings.lock().unwrap();
                        if s.linter_path.trim().is_empty() || s.linter_path == "kolang-linter" {
                            s.linter_path = p.to_string_lossy().to_string();
                            save_settings(&handle, &s);
                        }
                    }
                }

                dl.downloading.store(false, Ordering::Relaxed);
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
            get_binary_status,
        ])
        .run(tauri::generate_context!())
        .expect("خطا در اجرای kolang-ide");
}
