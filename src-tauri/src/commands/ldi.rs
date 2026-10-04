//! LDI call reproduction. Linked Windows owns presentation; this module owns
//! both the scalar managed hold and the typed interposer's native-boundary hold.
use super::breakpoints::Breakpoint;
use super::linked_windows::LdiSelection;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blue {
    pub(crate) file: String,
    pub(crate) line: u32,
    pub(crate) condition: Option<String>,
    pub(crate) origin_label: String,
    pub(crate) partner_label: String,
    pub(crate) origin_instance: String,
    pub(crate) partner_instance: String,
    pub(crate) partner_window_id: u32,
    pub(crate) entry_point: String,
    pub(crate) library: String,
    pub(crate) method: String,
    pub(crate) landing: String,
    pub(crate) mode: String,
    pub(crate) locals: [String; 2],
    pub(crate) warning: Option<String>,
    pub(crate) native_points: Vec<Breakpoint>,
    pub(crate) pending_restart: bool,
}

#[derive(Clone)]
pub(crate) struct ManagedBlueBreakpoint {
    pub file: String,
    pub line: u32,
    pub condition: Option<String>,
}

#[derive(Clone, Debug)]
struct Call {
    library: String,
    entry_point: String,
    method: String,
    locals: [String; 2],
    kind: CallKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum CallKind { ScalarI32, Utf8Bytes }

#[derive(Clone)]
struct Binding {
    blue: Blue,
    call: Call,
    native: Breakpoint,
    automatic_entry: bool,
    selection: LdiSelection,
    origin_cwd: String,
    native_source: String,
}

fn binding_key(binding: &Binding) -> String {
    format!("{}:{}", binding.blue.file, binding.blue.line)
}

fn binding_at<'a>(bindings: &'a [Binding], path: &Path, line: u32) -> Option<&'a Binding> {
    bindings.iter().find(|binding| binding.blue.line == line && same_source(path, Path::new(&binding.blue.file)))
}

#[derive(Clone)]
struct InterposerPrepared {
    folder: PathBuf,
    proxy: PathBuf,
    hook: PathBuf,
    arm: PathBuf,
    ready: PathBuf,
}

#[derive(Clone)]
struct InterposerCapture {
    file: PathBuf,
    release: PathBuf,
}

struct Pair {
    binding: Binding,
    bindings: Vec<Binding>,
    prepared: HashMap<String, (PathBuf, Option<InterposerPrepared>)>,
    origin_pgid: i32,
    partner_pgid: Option<i32>,
    token: u64,
    held: bool,
    phase: String,
    error: Option<String>,
    values: Option<[i32; 2]>,
    cancelled: Arc<AtomicBool>,
    partner_cancelled: Arc<AtomicBool>,
    library: Option<PathBuf>,
    completion: Option<PathBuf>,
    native_entered: bool,
    interposer: Option<InterposerPrepared>,
    capture: Option<InterposerCapture>,
}

#[derive(Default)]
struct State {
    blues: HashMap<String, Vec<Blue>>,
    pairs: HashMap<String, Pair>,
}

#[derive(Default)]
pub struct LdiManager(Mutex<State>);
impl Drop for LdiManager {
    fn drop(&mut self) {
        if let Ok(state) = self.0.lock() {
            for pair in state.pairs.values() {
                pair.cancelled.store(true, Ordering::Release);
                pair.partner_cancelled.store(true, Ordering::Release);
            }
        }
    }
}

pub(crate) fn regex(pattern: &str) -> Arc<Regex> {
    // Both recognizers reuse many constant patterns for every source line.
    // Cache compiled regexes only, never source results or binding identities.
    static PATTERNS: OnceLock<Mutex<HashMap<String, Arc<Regex>>>> = OnceLock::new();
    let mut patterns = PATTERNS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap_or_else(|e| e.into_inner());
    if let Some(compiled) = patterns.get(pattern) { return compiled.clone(); }
    let compiled = Arc::new(Regex::new(pattern).expect("constant LDI pattern"));
    if patterns.len() >= 128 { patterns.clear(); }
    patterns.insert(pattern.into(), compiled.clone());
    compiled
}

// A deliberately bounded syntax recognizer, not a C#/C++ language service.
// Erase comments without changing line numbers so commented imports/exports
// cannot establish a binding. Raw/verbatim string syntax is outside this slice.
pub(crate) fn without_comments(source: &str) -> Result<String, String> {
    let mut chars = source.chars().peekable();
    let mut result = String::new();
    let mut quote = None;
    while let Some(character) = chars.next() {
        if let Some(delimiter) = quote {
            result.push(character);
            if character == '\\' {
                if let Some(next) = chars.next() {
                    result.push(next);
                }
            } else if character == delimiter {
                quote = None;
            }
        } else if character == '/' && chars.peek() == Some(&'/') {
            chars.next();
            result.push_str("  ");
            for character in chars.by_ref() {
                result.push(if character == '\n' { '\n' } else { ' ' });
                if character == '\n' {
                    break;
                }
            }
        } else if character == '/' && chars.peek() == Some(&'*') {
            chars.next();
            result.push_str("  ");
            let mut closed = false;
            while let Some(character) = chars.next() {
                result.push(if character == '\n' { '\n' } else { ' ' });
                if character == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    result.push(' ');
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err("Unterminated comment in LDI source".into());
            }
        } else {
            result.push(character);
            if character == '"' || character == '\'' {
                quote = Some(character);
            }
        }
    }
    if result.contains("\"\"\"") || result.contains("@\"") || result.contains("R\"") {
        return Err("V1's bounded binding recognizer does not support raw/verbatim string syntax in this source".into());
    }
    Ok(result)
}

fn managed_call(source: &str, line: u32) -> Result<Call, String> {
    let source = without_comments(source)?;
    managed_call_clean(&source, line)
}

fn managed_call_clean(source: &str, line: u32) -> Result<Call, String> {
    let statement = source
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .ok_or("Call-site line is missing")?;
    let scalar_call = regex(
        r"^\s*(?:(?:int|var)\s+\w+\s*=\s*)?(\w+)\.(\w+)\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)\s*;\s*(?://.*)?$",
    );
    if let Some(call) = scalar_call.captures(statement) {
        return managed_scalar_call(&source, &call);
    }
    let buffer_call = regex(
        r"^\s*(?:(?:int|var)\s+\w+\s*=\s*)?(\w+)\.(\w+)\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*,\s*\(nuint\)\s*([A-Za-z_]\w*)\.Length\s*\)\s*;\s*$",
    );
    let call = buffer_call.captures(statement).ok_or("Blue needs a supported call site: two materialized Int32 values, or UTF-8 string + byte[] + (nuint)bytes.Length. Put blue on the call, not the DllImport declaration.")?;
    if call[4] != call[5] {
        return Err("The native buffer length must be this byte array's Length; LDI will not read beyond a managed array".into());
    }
    let imports = regex(
        r#"(?s)\[DllImport\(\s*"([A-Za-z_]\w*)"\s*(,[^\]]*)?\)\]\s*(?:public|private|internal)?\s*static\s+extern\s+int\s+(\w+)\s*\(\s*\[MarshalAs\(UnmanagedType\.LPUTF8Str\)\]\s*string\s+\w+\s*,\s*byte\[\]\s+\w+\s*,\s*nuint\s+\w+\s*\)\s*;"#,
    );
    let matches = imports.captures_iter(&source).filter(|import| import[3] == call[2]).collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("Interposer needs one same-file DllImport: [MarshalAs(LPUTF8Str)] string, byte[], nuint and int return".into());
    }
    let import = &matches[0];
    let attributes = import.get(2).map_or("", |item| item.as_str());
    if !regex(r"CallingConvention\s*=\s*CallingConvention\.Cdecl").is_match(attributes) {
        return Err("Interposer requires explicit CallingConvention.Cdecl".into());
    }
    let owner = regex(r"\bclass\s+(\w+)").captures_iter(&source[..import.get(0).unwrap().start()])
        .last().map(|item| item[1].to_string());
    if owner.as_deref() != Some(&call[1]) {
        return Err("The call qualifier does not match the import's class".into());
    }
    let export = regex(r#"EntryPoint\s*=\s*"([A-Za-z_]\w*)""#)
        .captures(attributes).map(|item| item[1].to_string()).unwrap_or_else(|| import[3].into());
    Ok(Call { library: import[1].into(), entry_point: export, method: call[2].into(),
        locals: [call[3].into(), call[4].into()], kind: CallKind::Utf8Bytes })
}

fn candidate_managed_calls(source: &str) -> Result<Vec<(u32, Call)>, String> {
    let clean = without_comments(source)?;
    Ok(clean.lines().enumerate().filter_map(|(index, statement)| {
        if !statement.contains('.') || !statement.contains('(') || !statement.contains(';') { return None; }
        let line = index as u32 + 1;
        managed_call_clean(&clean, line).ok().map(|call| (line, call))
    }).collect())
}

fn blue_matches_call(blue: &Blue, call: &Call) -> bool {
    blue.entry_point == call.entry_point && blue.library == call.library
        && blue.method == call.method && blue.locals == call.locals
        && blue.mode == if call.kind == CallKind::Utf8Bytes { "typed-interposer" } else { "scalar" }
}

/// A saved file is authoritative. Preserve exact sites, move only a unique
/// matching call, and never silently retarget an ambiguous Blue marker.
fn reconcile_blue_file(blues: &mut Vec<Blue>, file: &Path, source: &str) -> Result<bool, String> {
    let calls = candidate_managed_calls(source)?;
    let mut claimed = std::collections::HashSet::new();
    let mut retained = Vec::with_capacity(blues.len());
    let mut displaced = Vec::new();
    for blue in blues.drain(..) {
        if !same_source(Path::new(&blue.file), file) {
            retained.push(blue);
        } else if calls.iter().any(|(line, call)| *line == blue.line && blue_matches_call(&blue, call)) {
            claimed.insert(blue.line);
            retained.push(blue);
        } else {
            displaced.push(blue);
        }
    }
    let mut changed = false;
    for mut blue in displaced {
        let matches = calls.iter().filter(|(line, call)| !claimed.contains(line) && blue_matches_call(&blue, call))
            .map(|(line, _)| *line).collect::<Vec<_>>();
        if matches.len() == 1 {
            blue.line = matches[0];
            blue.warning = None;
            claimed.insert(blue.line);
            retained.push(blue);
            changed = true;
        } else if matches.len() > 1 {
            blue.warning = Some("The C# call moved ambiguously; recreate Blue at the intended call site".into());
            retained.push(blue);
            changed = true;
        } else if calls.iter().any(|(_, call)| call.method == blue.method && call.entry_point == blue.entry_point) {
            blue.warning = Some("The C# native call changed; recreate Blue at the intended call site".into());
            retained.push(blue);
            changed = true;
        } else {
            changed = true;
        }
    }
    *blues = retained;
    Ok(changed)
}

fn managed_scalar_call(source: &str, call: &regex::Captures<'_>) -> Result<Call, String> {
    let imports = regex(
        r#"(?s)\[DllImport\(\s*"([A-Za-z_]\w*)"\s*(,[^\]]*)?\)\]\s*(?:public|private|internal)?\s*static\s+extern\s+int\s+(\w+)\s*\(\s*int\s+\w+\s*,\s*int\s+\w+\s*\)\s*;"#,
    );
    let matches = imports
        .captures_iter(&source)
        .filter(|import| import[3] == call[2])
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(
            "V1 needs one unambiguous, same-file DllImport: two int inputs and an int result"
                .into(),
        );
    }
    let import = &matches[0];
    let attributes = import.get(2).map_or("", |item| item.as_str());
    if !regex(r"CallingConvention\s*=\s*CallingConvention\.Cdecl").is_match(attributes) {
        return Err("V1 requires an explicit CallingConvention.Cdecl".into());
    }
    let owner = regex(r"\bclass\s+(\w+)")
        .captures_iter(&source[..import.get(0).unwrap().start()])
        .last()
        .map(|item| item[1].to_string());
    if owner.as_deref() != Some(&call[1]) {
        return Err("The call qualifier does not match the import's class".into());
    }
    let export = regex(r#"EntryPoint\s*=\s*"([A-Za-z_]\w*)""#)
        .captures(attributes)
        .map(|item| item[1].to_string())
        .unwrap_or_else(|| import[3].into());
    Ok(Call {
        library: import[1].into(),
        entry_point: export,
        method: call[2].into(),
        locals: [call[3].into(), call[4].into()],
        kind: CallKind::ScalarI32,
    })
}

fn native_signature(export: &str, kind: CallKind) -> Arc<Regex> {
    let arguments = match kind {
        CallKind::ScalarI32 => r"(?:int32_t|int)\s+\w+\s*,\s*(?:int32_t|int)\s+\w+",
        CallKind::Utf8Bytes => r"const\s+char\s*\*\s*\w+\s*,\s*const\s+uint8_t\s*\*\s*\w+\s*,\s*size_t\s+\w+",
    };
    regex(&format!(r#"(?m)^[ \t]*extern\s+"C"\s+(?:int32_t|int)\s+{}\s*\(\s*{}\s*\)\s*\{{"#,
        regex::escape(export), arguments))
}

fn native_contains(source: &str, line: u32, export: &str, kind: CallKind) -> bool {
    let Ok(source) = without_comments(source) else { return false; };
    let signature = native_signature(export, kind);
    let contains = signature.find_iter(&source).any(|found| {
        let start = source[..found.start()].lines().count() as u32 + 1;
        let mut depth = 1;
        let end = source[found.end()..]
            .char_indices()
            .find_map(|(offset, character)| {
                if character == '{' {
                    depth += 1;
                }
                if character == '}' {
                    depth -= 1;
                }
                (depth == 0).then_some(found.end() + offset)
            });
        end.is_some_and(|end| line >= start && line <= source[..end].lines().count() as u32 + 1)
    });
    contains
}

fn native_points(call: &Call, selection: &LdiSelection) -> Result<Vec<Breakpoint>, String> {
    let root = Path::new(&selection.spec.cwd)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let matches = super::breakpoints::load_breakpoints(selection.solution.clone())?
        .into_iter()
        .filter(|point| {
            let path = Path::new(&point.file);
            matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("c" | "cpp" | "cc" | "cxx")
            ) && path
                .canonicalize()
                .is_ok_and(|file| file.starts_with(&root))
                && fs::read_to_string(path)
                    .is_ok_and(|source| native_contains(&source, point.line, &call.entry_point, call.kind))
        })
        .collect::<Vec<_>>();
    Ok(matches)
}

/// Find a unique executable definition, never a header declaration. The
/// selected CMake artifact is checked to compile this exact source later.
fn native_definition(call: &Call, selection: &LdiSelection) -> Result<Breakpoint, String> {
    let root = Path::new(&selection.spec.cwd).canonicalize().map_err(|error| error.to_string())?;
    let mut folders = VecDeque::from([(root.clone(), 0usize)]);
    let mut definitions = vec![];
    let mut scanned = 0usize;
    let signature = native_signature(&call.entry_point, call.kind);
    while let Some((folder, depth)) = folders.pop_front() {
        for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() { continue; }
            let path = entry.path();
            if kind.is_dir() {
                let name = entry.file_name();
                if depth < 8 && !matches!(name.to_str(), Some("build" | "bin" | "obj" | "target" | "captures" | ".git")) {
                    folders.push_back((path, depth + 1));
                }
                continue;
            }
            if !kind.is_file() || !matches!(path.extension().and_then(|value| value.to_str()), Some("c" | "cpp" | "cc" | "cxx")) { continue; }
            scanned += 1;
            if scanned > 2000 { return Err("Native source tree is too large for automatic LDI entry; set an explicit red breakpoint".into()); }
            let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let Ok(source) = without_comments(&source) else { continue; };
            for found in signature.find_iter(&source) {
                definitions.push(Breakpoint { file: path.to_string_lossy().into_owned(),
                    line: source[..found.start()].bytes().filter(|byte| *byte == b'\n').count() as u32 + 1,
                    scope: "ldi-auto-entry".into(), condition: None });
            }
        }
    }
    if definitions.len() != 1 {
        return Err(format!("Automatic LDI entry needs exactly one .c/.cpp definition of {} with the supported signature in CS{}'s native project (found {}). Set red inside a matching export or resolve the ambiguity.",
            call.entry_point, selection.window_id, definitions.len()));
    }
    Ok(definitions.remove(0))
}

fn resolve_native(call: &Call, selection: &LdiSelection) -> Result<(Breakpoint, bool), String> {
    if let Some(red) = native_points(call, selection)?.into_iter().min_by_key(|point| point.line) {
        return Ok((red, false));
    }
    native_definition(call, selection).map(|point| (point, true))
}

fn selected_target_matches(args: &[String], library: &str) -> bool {
    argument(args, "--target").is_none_or(|target| target == library)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueCallSitePreview {
    pub(crate) line: u32,
    pub(crate) entry_point: String,
    pub(crate) partner_labels: Vec<String>,
    pub(crate) config_names: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdiPreviewConfig {
    pub(crate) name: String,
    pub(crate) cwd: String,
    pub(crate) args: Vec<String>,
}

#[tauri::command]
pub async fn list_ldi_call_sites(
    window: WebviewWindow,
    app: AppHandle,
    file: String,
    partner_labels: Vec<String>,
    preview_configs: Vec<LdiPreviewConfig>,
) -> Result<Vec<BlueCallSitePreview>, String> {
    if partner_labels.len() > 16 { return Err("Too many native partners to preview".into()); }
    if preview_configs.len() > 32 { return Err("Too many native configurations to preview".into()); }
    let origin_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        if file.ends_with(".rs") {
            return super::native_debug::preview(&app, &origin_label, &file, &partner_labels, &preview_configs);
        }
        let origin = super::linked_windows::ldi_origin_selection(&app, &origin_label)?;
        let selections = partner_labels.into_iter().filter_map(|label|
            super::linked_windows::ldi_selections(&app, &origin_label, &label).ok().map(|(origin, partner)| (origin, partner))
        ).collect::<Vec<_>>();
        let path = Path::new(&file).canonicalize().map_err(|error| error.to_string())?;
        if path.extension().and_then(|part| part.to_str()) != Some("cs") { return Ok(vec![]); }
        let root = Path::new(&origin.spec.cwd).canonicalize().map_err(|error| error.to_string())?;
        if !path.starts_with(root) { return Ok(vec![]); }
        if path.metadata().map_err(|error| error.to_string())?.len() > 1_000_000 { return Ok(vec![]); }
        let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let solution_root = Path::new(&origin.solution).parent().ok_or("Invalid solution path")?
            .canonicalize().map_err(|error| error.to_string())?;
        let prospective = preview_configs.into_iter().filter_map(|config| {
            let cwd = Path::new(&config.cwd).canonicalize().ok()?;
            if !cwd.starts_with(&solution_root) || !config.args.iter().any(|arg| arg == "--build") { return None; }
            Some((config.name, LdiSelection { label: "preview".into(), instance_id: String::new(),
                configuration: None, profile: None,
                window_id: 0, solution: origin.solution.clone(), spec: super::runner::RunSpec {
                    label: "preview".into(), program: "cmake".into(), args: config.args,
                    env: Default::default(), cwd: cwd.to_string_lossy().into_owned(),
                    linked: None, order: None,
                } }))
        }).collect::<Vec<_>>();
        let mut previews = vec![];
        let mut available = HashMap::new();
        for (line, call) in candidate_managed_calls(&source)? {
            let matching = selections.iter().filter_map(|(_, partner)| {
                if !selected_target_matches(&partner.spec.args, &call.library) { return None; }
                let key = (partner.label.clone(), call.entry_point.clone(), call.kind);
                if !*available.entry(key).or_insert_with(|| resolve_native(&call, partner).is_ok()) { return None; }
                Some(partner.label.clone())
            }).collect::<Vec<_>>();
            let configs = prospective.iter().filter_map(|(name, selection)| {
                if !selected_target_matches(&selection.spec.args, &call.library) { return None; }
                let key = (name.clone(), call.entry_point.clone(), call.kind);
                if !*available.entry(key).or_insert_with(|| resolve_native(&call, selection).is_ok()) { return None; }
                Some(name.clone())
            }).collect::<Vec<_>>();
            if !matching.is_empty() || !configs.is_empty() {
                previews.push(BlueCallSitePreview { line, entry_point: call.entry_point,
                    partner_labels: matching, config_names: configs });
            }
        }
        Ok(previews)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_ldi_blue(
    window: WebviewWindow,
    app: AppHandle,
    file: String,
    line: u32,
    partner_label: String,
    condition: Option<String>,
) -> Result<Blue, String> {
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || set_blue_for_label(&app, &owner, file, line, partner_label, condition))
        .await.map_err(|error| error.to_string())?
}

fn set_blue_for_label(app: &AppHandle, owner: &str, file: String, line: u32, partner_label: String, condition: Option<String>) -> Result<Blue, String> {
    if file.ends_with(".rs") {
        return super::native_debug::set_blue(app, owner, &file, line, &partner_label, condition);
    }
    let (origin, partner) =
        super::linked_windows::ldi_selections(app, owner, &partner_label)?;
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pending_restart = state
        .pairs
        .get(owner)
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire));
    let path = Path::new(&file)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if line == 0 || path.extension().and_then(|part| part.to_str()) != Some("cs") {
        return Err("Blue needs a nonzero line in a C# source file".into());
    }
    if !path.starts_with(
        Path::new(&origin.spec.cwd)
            .canonicalize()
            .map_err(|error| error.to_string())?,
    ) {
        return Err("Blue must be in the selected C# project's debug directory".into());
    }
    let call = managed_call(
        &fs::read_to_string(&path).map_err(|error| error.to_string())?,
        line,
    )?;
    let condition = condition.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    if condition.as_ref().is_some_and(|value| value.len() > 256 || value.chars().any(char::is_control)) {
        return Err("A blue condition must be one line and at most 256 bytes".into());
    }
    let landing = resolve_native(&call, &partner);
    let mut blue = Blue {
        file: path.to_string_lossy().into_owned(),
        line,
        condition,
        origin_label: origin.label.clone(),
        partner_label: partner.label.clone(),
        origin_instance: origin.instance_id,
        partner_instance: partner.instance_id.clone(),
        partner_window_id: partner.window_id,
        entry_point: call.entry_point.clone(),
        library: call.library.clone(),
        method: call.method.clone(),
        landing: if landing.as_ref().is_ok_and(|(_, automatic)| *automatic) { "automatic-entry" } else { "red" }.into(),
        mode: if call.kind == CallKind::Utf8Bytes { "typed-interposer" } else { "scalar" }.into(),
        locals: call.locals.clone(),
        warning: landing.err(),
        native_points: native_points(&call, &partner).unwrap_or_default(),
        pending_restart,
    };
    let blues = state.blues.entry(origin.label).or_default();
    blues.retain(|existing| existing.file != blue.file || existing.line != blue.line);
    blues.push(blue.clone());
    drop(state);
    blue.pending_restart |= super::linked_windows::ldi_debug_group_active(&app, &blue.origin_label);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(blue)
}

#[tauri::command]
pub fn remove_ldi_blue(window: WebviewWindow, app: AppHandle, file: String, line: u32) -> Result<bool, String> {
    if file.ends_with(".rs") { return super::native_debug::remove_blue(&app, window.label(), &file, line); }
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pending_restart = state
        .pairs
        .get(window.label())
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire));
    if let Some(blues) = state.blues.get_mut(window.label()) {
        blues.retain(|blue| !same_source(Path::new(&blue.file), Path::new(&file)) || blue.line != line);
    }
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(pending_restart || super::linked_windows::ldi_debug_group_active(&app, window.label()))
}

#[tauri::command]
pub fn reconcile_ldi_blues_on_save(app: AppHandle, file: String) -> Result<bool, String> {
    if file.ends_with(".rs") { return super::native_debug::reconcile(&app, &file); }
    let path = Path::new(&file).canonicalize().map_err(|error| error.to_string())?;
    if path.extension().and_then(|part| part.to_str()) != Some("cs") { return Ok(false); }
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let owners = state.blues.iter().filter(|(_, blues)|
        blues.iter().any(|blue| same_source(Path::new(&blue.file), &path)))
        .map(|(owner, _)| owner.clone()).collect::<Vec<_>>();
    let active = owners.iter().any(|owner| state.pairs.get(owner).is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire)));
    if owners.is_empty() { return Ok(false); }
    let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut changed = false;
    for owner in owners {
        if let Some(blues) = state.blues.get_mut(&owner) {
            changed |= reconcile_blue_file(blues, &path, &source)?;
        }
    }
    drop(state);
    if changed { let _ = app.emit("craidd:ldi-blues", ()); }
    Ok(changed && active)
}

#[tauri::command]
pub async fn get_ldi_blues(window: WebviewWindow, app: AppHandle) -> Vec<Blue> {
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || blues_for_label(&app, &owner)).await.unwrap_or_default()
}

fn blues_for_label(app: &AppHandle, owner: &str) -> Vec<Blue> {
    let mut rust_blues = super::native_debug::blues(app, owner);
    let manager = app.state::<LdiManager>();
    let Ok(state) = manager.0.lock() else {
        return vec![];
    };
    let points = state.blues.values().flatten().filter(|blue| blue.origin_label == owner || blue.partner_label == owner).cloned().map(|mut blue| {
        blue.pending_restart = state.pairs.get(&blue.origin_label).is_some_and(|pair|
            !pair.cancelled.load(Ordering::Acquire) && !pair.bindings.iter().any(|binding|
                binding.blue.file == blue.file && binding.blue.line == blue.line
                    && binding.blue.partner_label == blue.partner_label && binding.blue.condition == blue.condition
                    && blue_matches_call(&blue, &binding.call)));
        blue
    }).collect::<Vec<_>>();
    let active_origins = state.pairs.iter().filter(|(_, pair)| !pair.cancelled.load(Ordering::Acquire))
        .map(|(origin, _)| origin.clone()).collect::<std::collections::HashSet<_>>();
    drop(state);
    let managed = points
        .into_iter()
        .filter_map(|mut blue| {
            if !active_origins.contains(&blue.origin_label) {
                blue.pending_restart = super::linked_windows::ldi_debug_group_active(&app, &blue.origin_label);
            }
            let (a, b) = super::linked_windows::ldi_selections(
                &app,
                &blue.origin_label,
                &blue.partner_label,
            )
            .ok()?;
            if owner != a.label && owner != b.label {
                return None;
            }
            if a.instance_id != blue.origin_instance || b.instance_id != blue.partner_instance {
                return None;
            }
            let binding = fs::read_to_string(&blue.file)
                .map_err(|error| error.to_string())
                .and_then(|source| managed_call(&source, blue.line))
                .and_then(|call| {
                    let mode = if call.kind == CallKind::Utf8Bytes { "typed-interposer" } else { "scalar" };
                    if !blue_matches_call(&blue, &call) || blue.mode != mode {
                        Err("The C# call site changed; recreate blue before Gold Debug".into())
                    } else { Ok(call) }
                });
            let landing = binding.as_ref().map_err(Clone::clone).and_then(|call| resolve_native(call, &b));
            blue.warning = landing.as_ref().err().cloned();
            if let Ok((_, automatic)) = landing { blue.landing = if automatic { "automatic-entry" } else { "red" }.into(); }
            blue.native_points = binding.and_then(|call| native_points(&call, &b)).unwrap_or_default();
            Some(blue)
        })
        .collect::<Vec<_>>();
    rust_blues.extend(managed);
    rust_blues
}

pub(crate) fn prepare_pairs(
    app: &AppHandle,
    origin_label: &str,
    partner_labels: &[String],
) -> Result<super::debug::DebugRequest, String> {
    let first = partner_labels.first().ok_or("Select a native library window")?;
    let (a, _) = super::linked_windows::ldi_selections(app, origin_label, first)?;
    if !super::debug::adapter_available_for_language("cpp")
        || !super::debug::adapter_available_for_language("csharp")
    {
        return Err("LDI needs both netcoredbg and lldb-dap".into());
    }
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    if state
        .pairs
        .get(origin_label)
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire))
    {
        return Err("An LDI pair is already armed; stop it before starting another".into());
    }
    let blues = state
        .blues
        .get(origin_label)
        .cloned().unwrap_or_default();
    let mut bindings = Vec::new();
    for blue in blues {
        if !partner_labels.contains(&blue.partner_label) {
            return Err("The blue breakpoint's native window is no longer selected".into());
        }
        let (_, b) = super::linked_windows::ldi_selections(app, origin_label, &blue.partner_label)?;
        if blue.origin_instance != a.instance_id || blue.partner_instance != b.instance_id {
            return Err("The LDI window instances changed; recreate the blue binding".into());
        }
        let call = managed_call(&fs::read_to_string(&blue.file).map_err(|error| error.to_string())?, blue.line)?;
        let call_mode = if call.kind == CallKind::Utf8Bytes { "typed-interposer" } else { "scalar" };
        if !blue_matches_call(&blue, &call) || blue.mode != call_mode {
            return Err("The C# call site changed since blue was set; recreate its Native Debugging Breakpoint".into());
        }
        let (native, automatic_entry) = resolve_native(&call, &b)?;
        let native_source = fs::read_to_string(&native.file).map_err(|error| error.to_string())?;
        bindings.push(Binding { blue, call, native, automatic_entry, selection: b, origin_cwd: a.spec.cwd.clone(), native_source });
    }
    if bindings.is_empty() {
        // All Blue markers may have been removed by a save. Gold still
        // debugs the applications; library windows wait for the next setup.
        return Ok(super::debug::DebugRequest { cwd: a.spec.cwd, solution_path: a.solution,
            method: "dotnet".into(), profile: "Debug".into(), command_args: a.spec.args,
            env: a.spec.env, order: a.spec.order, breakpoints: vec![], ldi_token: None });
    }
    let typed_imports = bindings.iter().filter(|binding| binding.call.kind == CallKind::Utf8Bytes)
        .map(|binding| (binding.call.library.clone(), binding.call.method.clone(),
            binding.call.entry_point.clone(), binding.blue.partner_label.clone()))
        .collect::<std::collections::HashSet<_>>();
    if typed_imports.len() > 1 {
        return Err("This LDI provider supports one typed DllImport per C# process (at any number of blue call sites); scalar calls may use other native windows".into());
    }
    let binding = bindings[0].clone();
    let token = NEXT.fetch_add(1, Ordering::Relaxed);
    state.pairs.insert(
        origin_label.into(),
        Pair {
            binding,
            bindings,
            prepared: HashMap::new(),
            origin_pgid: 0,
            partner_pgid: None,
            token,
            held: false,
            phase: "armed".into(),
            error: None,
            values: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            partner_cancelled: Arc::new(AtomicBool::new(false)),
            library: None,
            completion: None,
            native_entered: false,
            interposer: None,
            capture: None,
        },
    );
    Ok(super::debug::DebugRequest {
        cwd: a.spec.cwd,
        solution_path: a.solution,
        method: "dotnet".into(),
        profile: "Debug".into(),
        command_args: a.spec.args,
        env: a.spec.env,
        order: a.spec.order,
        breakpoints: vec![],
        ldi_token: Some(token),
    })
}

pub(crate) fn active_blues(app: &AppHandle, label: &str) -> Vec<ManagedBlueBreakpoint> {
    let manager = app.state::<LdiManager>();
    let Ok(state) = manager.0.lock() else { return vec![]; };
    let Some(pair) = state
        .pairs
        .get(label)
        .filter(|pair| !pair.cancelled.load(Ordering::Acquire)) else { return vec![]; };
    pair.bindings.iter().map(|binding| ManagedBlueBreakpoint {
        file: binding.blue.file.clone(), line: binding.blue.line,
        condition: binding.blue.condition.clone(),
    }).collect()
}

pub(crate) fn validate_origin_program(
    app: &AppHandle,
    label: &str,
    program: &Path,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let libraries = {
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get(label).ok_or("LDI origin disappeared")?;
        pair.bindings.iter().map(|binding| pair.prepared.get(&binding_key(binding))
            .map(|(library, _)| (binding.call.library.clone(), library.clone()))
            .ok_or_else(|| "LDI library was not prepared".to_string())).collect::<Result<Vec<_>, String>>()?
    };
    let directory = program
        .parent()
        .ok_or("Managed program directory is missing")?;
    for (name, library) in libraries {
        for filename in [format!("lib{name}.so"), format!("{name}.so"), format!("lib{name}"), name] {
            let candidate = directory.join(filename);
            if candidate.is_file() && !same_source(&candidate, &library) && !same_binary(&candidate, &library)? {
                return Err(format!("{} shadows the selected LDI library with different code. Add a build-order install step for the selected library before debugging; LDI will not silently overwrite it.", candidate.display()));
            }
        }
    }
    Ok(())
}

pub(crate) fn configure_origin_launch_env(
    app: &AppHandle, label: &str, program: &Path,
    env: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let state = manager.0.lock().map_err(|error| error.to_string())?;
    let pair = state.pairs.get(label).ok_or("LDI origin disappeared")?;
    if pair.bindings.iter().any(|binding| binding.call.kind == CallKind::Utf8Bytes) {
        let program = program.canonicalize().map_err(|error| error.to_string())?;
        if program.extension().and_then(|part| part.to_str()) != Some("dll") {
            return Err("Interposer needs a managed .dll launch target".into());
        }
        env.insert("LDI_MANAGED_ASSEMBLY".into(), program.to_string_lossy().into_owned());
    }
    Ok(())
}

fn same_binary(a: &Path, b: &Path) -> Result<bool, String> {
    use std::io::Read;
    let mut a = fs::File::open(a).map_err(|error| error.to_string())?;
    let mut b = fs::File::open(b).map_err(|error| error.to_string())?;
    let mut remaining = a.metadata().map_err(|error| error.to_string())?.len();
    if remaining != b.metadata().map_err(|error| error.to_string())?.len() {
        return Ok(false);
    }
    let (mut left, mut right) = ([0; 65536], [0; 65536]);
    while remaining > 0 {
        let size = remaining.min(left.len() as u64) as usize;
        a.read_exact(&mut left[..size])
            .map_err(|error| error.to_string())?;
        b.read_exact(&mut right[..size])
            .map_err(|error| error.to_string())?;
        if left[..size] != right[..size] {
            return Ok(false);
        }
        remaining -= size as u64;
    }
    Ok(true)
}

fn notify(app: &AppHandle, pair: &Pair) {
    let value = json!({"originLabel":pair.binding.blue.origin_label, "partnerLabel":pair.binding.blue.partner_label,
        "partnerWindowId":pair.binding.blue.partner_window_id, "file":pair.binding.blue.file, "line":pair.binding.blue.line,
        "nativeFile":pair.binding.native.file, "nativeLine":pair.binding.native.line,
        "entryPoint":pair.binding.call.entry_point, "landing":if pair.binding.automatic_entry { "automatic-entry" } else { "red" },
        "mode":pair.binding.blue.mode, "locals":pair.binding.call.locals, "values":pair.values,
        "token":pair.token.to_string(), "held":pair.held, "phase":pair.phase, "error":pair.error});
    for label in [
        &pair.binding.blue.origin_label,
        &pair.binding.blue.partner_label,
    ] {
        let _ = app.emit_to(label, "craidd:ldi-state", &value);
    }
}

pub(crate) fn check_launch(app: &AppHandle, label: &str, token: Option<u64>) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let state = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(token) = token {
        if !state.pairs.values().any(|pair| {
            (pair.binding.blue.origin_label == label || pair.binding.blue.partner_label == label)
                && pair.token == token
                && !pair.cancelled.load(Ordering::Acquire)
                && (pair.binding.blue.partner_label != label
                    || !pair.partner_cancelled.load(Ordering::Acquire))
        }) {
            return Err("LDI session was stopped or replaced".into());
        }
    } else if state.pairs.values().any(|pair| {
        (pair.binding.blue.origin_label == label || pair.bindings.iter().any(|binding| binding.blue.partner_label == label))
            && !pair.cancelled.load(Ordering::Acquire)
    }) {
        return Err(
            "Stop Gold Linked Debug before starting an independent debugger in this window".into(),
        );
    }
    Ok(())
}

pub(crate) fn adapter_started(
    app: &AppHandle,
    label: &str,
    pgid: i32,
    token: Option<u64>,
) -> Result<(), String> {
    let Some(token) = token else {
        return Ok(());
    };
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    for (origin, pair) in &mut state.pairs {
        if origin != label && pair.binding.blue.partner_label != label {
            continue;
        }
        if pair.cancelled.load(Ordering::Acquire)
            || pair.token != token
            || (origin != label && pair.partner_cancelled.load(Ordering::Acquire))
        {
            return Err("LDI session was stopped or replaced".into());
        }
        if origin == label {
            pair.origin_pgid = pgid;
        } else {
            pair.partner_pgid = Some(pgid);
            pair.phase = "native".into();
        }
        notify(app, pair);
    }
    Ok(())
}

pub(crate) fn on_stop(app: &AppHandle, label: &str, pgid: i32) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    if let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && !pair.cancelled.load(Ordering::Acquire))
    {
        if pair.held {
            return;
        }
        // Lock before exposing Paused to the renderer; frame verification follows.
        pair.held = true;
        pair.phase = "checking-stop".into();
        notify(app, pair);
    } else if let Some(pair) = state.pairs.values_mut().find(|pair| {
        pair.binding.blue.partner_label == label
            && pair.partner_pgid == Some(pgid)
            && pair.held
            && !pair.cancelled.load(Ordering::Acquire)
            && !pair.partner_cancelled.load(Ordering::Acquire)
    }) {
        // Block a second B control until this stop's source is known.
        pair.phase = "checking-native-stop".into();
    }
}

/// True only for the private driver frame reached by stepping out of the
/// selected native function. The reader consumes that stop and completes B.
pub(crate) fn on_frame(
    app: &AppHandle,
    label: &str,
    pgid: i32,
    frame: &Value,
    reason: Option<&str>,
) -> bool {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return false;
    };
    if let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && !pair.cancelled.load(Ordering::Acquire))
    {
        if pair.phase != "checking-stop" {
            return false;
        }
        let matched = frame["source"]["path"].as_str().zip(frame["line"].as_u64())
            .and_then(|(path, line)| binding_at(&pair.bindings, Path::new(path), line as u32)).cloned();
        let at_blue = matched.is_some();
        if let Some(mut binding) = matched {
            // Red breakpoints may be added while Gold Debug is already armed.
            // Choose B's landing for this call, not from the startup snapshot.
            // Source saved mid-session belongs to the next build. Keep the
            // landing and source ranges corresponding to the loaded library.
            if fs::read_to_string(&binding.native.file).is_ok_and(|source| source == binding.native_source) {
                match resolve_native(&binding.call, &binding.selection) {
                    Ok((native, automatic_entry)) => {
                        binding.native = native;
                        binding.automatic_entry = automatic_entry;
                    }
                    Err(error) => {
                        pair.held = true;
                        pair.phase = "failed".into();
                        pair.error = Some(format!("Could not select B's native landing: {error}. A remains held."));
                        notify(app, pair);
                        return false;
                    }
                }
            }
            let Some((library, interposer)) = pair.prepared.get(&binding_key(&binding)).cloned() else {
                pair.phase = "failed".into();
                pair.error = Some("The selected LDI library was not prepared. A remains held.".into());
                notify(app, pair);
                return false;
            };
            pair.library = Some(library);
            pair.interposer = interposer;
            pair.binding = binding;
        }
        pair.held = at_blue;
        pair.phase = if at_blue { "reading" } else { "armed" }.into();
        if at_blue {
            pair.token = NEXT.fetch_add(1, Ordering::Relaxed);
            pair.partner_pgid = None;
            pair.partner_cancelled = Arc::new(AtomicBool::new(false));
            pair.values = None;
            pair.completion = None;
            pair.capture = None;
            pair.native_entered = false;
            pair.error = None;
        }
        notify(app, pair);
    } else if let Some(pair) = state.pairs.values_mut().find(|pair| {
        pair.partner_pgid == Some(pgid)
            && pair.binding.blue.partner_label == label
            && pair.held
            && !pair.cancelled.load(Ordering::Acquire)
            && !pair.partner_cancelled.load(Ordering::Acquire)
    }) {
        let source = frame["source"]["path"].as_str().map(Path::new);
        if source.is_some_and(|source| same_source(source, Path::new(&pair.binding.native.file)))
            && frame["line"].as_u64().is_some_and(|line| native_contains(&pair.binding.native_source, line as u32,
                    &pair.binding.call.entry_point, pair.binding.call.kind)) {
            pair.native_entered = true;
        }
        let driver = pair
            .completion
            .as_ref()
            .and_then(|file| file.parent())
            .map(|folder| folder.join("driver.cpp"));
        if should_finish_native_step(reason, pair.native_entered, source, driver.as_deref()) {
            pair.phase = "finishing-native".into();
            notify(app, pair);
            return true;
        }
        pair.phase = "native".into();
        notify(app, pair);
        if let Some(window) = app.get_webview_window(&pair.binding.blue.partner_label) {
            let _ = window.set_focus();
        }
    }
    false
}

fn should_finish_native_step(
    reason: Option<&str>,
    native_entered: bool,
    source: Option<&Path>,
    driver: Option<&Path>,
) -> bool {
    reason == Some("step")
        && native_entered
        && source
            .zip(driver)
            .is_some_and(|(source, driver)| same_source(source, driver))
}

pub(crate) fn partner_stop_is_held(app: &AppHandle, label: &str, pgid: i32) -> bool {
    let manager = app.state::<LdiManager>();
    manager.0.lock().is_ok_and(|state| {
        state.pairs.values().any(|pair| {
            pair.partner_pgid == Some(pgid)
                && pair.binding.blue.partner_label == label
                && pair.held
                && !pair.cancelled.load(Ordering::Acquire)
        })
    })
}

pub(crate) fn native_auto_resume_failed(app: &AppHandle, label: &str, pgid: i32, error: &str) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    if let Some(pair) = state.pairs.values_mut().find(|pair| {
        pair.partner_pgid == Some(pgid)
            && pair.binding.blue.partner_label == label
            && pair.held
            && pair.phase == "finishing-native"
    }) {
        pair.phase = "failed".into();
        pair.error = Some(format!(
            "Could not finish B after returning from native code: {error}. A remains held."
        ));
        notify(app, pair);
    }
}

fn scalar(variables: &[Value], name: &str) -> Result<i32, String> {
    let matches = variables
        .iter()
        .filter(|value| value["name"] == name)
        .collect::<Vec<_>>();
    if matches.len() != 1
        || !matches!(matches[0]["type"].as_str(), Some("int" | "System.Int32"))
        || matches[0]["variablesReference"].as_i64().unwrap_or(0) != 0
    {
        return Err(format!(
            "{name} is not an unambiguous readable Int32 local/parameter. A remains held."
        ));
    }
    matches[0]["value"]
        .as_str()
        .and_then(|text| text.parse::<i32>().ok())
        .ok_or_else(|| format!("{name} has an unsupported debugger value. A remains held."))
}

fn arm_interposer(
    app: &AppHandle, pair: &mut Pair,
) -> Result<(InterposerCapture, u64, u32, u32), String> {
    let prepared = pair.interposer.as_ref().ok_or("LDI interposer was not prepared")?;
    if prepared.arm.exists() {
        return Err("A previous interposer arm is still present; use Gold Stop instead of continuing an ambiguous call".into());
    }
    let origin_pid = fs::read_to_string(&prepared.ready)
        .map_err(|_| "The LDI startup hook did not confirm the selected DllImport resolver")?
        .trim().parse::<u32>().map_err(|_| "LDI startup hook reported an invalid process ID")?;
    if origin_pid == 0 { return Err("LDI startup hook reported an invalid process ID".into()); }
    let tid = super::debug::ldi_origin_thread_id(app, &pair.binding.blue.origin_label, pair.origin_pgid)?;
    if !Path::new("/proc").join(origin_pid.to_string()).join("task").join(tid.to_string()).is_dir() {
        return Err("netcoredbg's stopped thread ID is not a Linux thread in the hooked process; refusing to resume blue".into());
    }
    let folder = prepared.folder.join(format!("capture-{}", pair.token));
    fs::create_dir(&folder).map_err(|error| error.to_string())?;
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())?;
    let capture = InterposerCapture { file: folder.join("capture.bin"), release: folder.join("release.fifo") };
    let fifo = std::ffi::CString::new(capture.release.as_os_str().as_bytes()).map_err(|_| "Invalid release path")?;
    if unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) } != 0 {
        return Err(format!("Could not create LDI release gate: {}", std::io::Error::last_os_error()));
    }
    let temporary = folder.join("arm.tmp");
    let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
        .open(&temporary).map_err(|error| error.to_string())?;
    writeln!(file, "{}\n{}\n{}\n{}", pair.token, tid, capture.file.display(), capture.release.display())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::hard_link(&temporary, &prepared.arm).map_err(|error| format!("Another LDI call is still armed: {error}"))?;
    fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    pair.capture = Some(capture.clone());
    pair.phase = "boundary-arming".into();
    pair.error = None;
    notify(app, pair);
    if let Err(error) = super::debug::continue_ldi_origin(app, &pair.binding.blue.origin_label, pair.origin_pgid) {
        let _ = fs::remove_file(&prepared.arm);
        pair.capture = None;
        return Err(error);
    }
    pair.phase = "boundary-wait".into();
    notify(app, pair);
    Ok((capture, pair.token, tid, origin_pid))
}

fn capture_u32(record: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(record[at..at + 4].try_into().expect("checked record"))
}
fn capture_u64(record: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(record[at..at + 8].try_into().expect("checked record"))
}

fn verify_interposer_capture(
    capture: &Path, token: u64, expected_tid: u32, expected_pid: u32,
) -> Result<(), String> {
    let record = fs::read(capture).map_err(|error| error.to_string())?;
    verify_interposer_record(&record, token, expected_tid, expected_pid)
}

fn verify_interposer_record(
    record: &[u8], token: u64, expected_tid: u32, expected_pid: u32,
) -> Result<(), String> {
    if record.len() < 36 || &record[..3] != b"LDI" || capture_u32(record, 4) != 0x3155424c
        || capture_u64(record, 8) != token || capture_u32(record, 16) != expected_pid
        || capture_u32(record, 20) != expected_tid {
        return Err("LDI capture identity, source thread, or signature did not match the blue stop".into());
    }
    let label = capture_u32(record, 24) as usize;
    let bytes = capture_u32(record, 28) as usize;
    let problem = capture_u32(record, 32);
    if record[3] == b'E' && problem != 0 && record.len() == 36 {
        let reason = match problem { 1 => "null string", 2 => "UTF-8 string exceeds 4096 bytes",
            3 => "byte buffer exceeds 4096 bytes", 4 => "null byte buffer with nonzero length", _ => "unknown unsupported input" };
        return Err(format!("This call is detectably non-reproducible: {reason}. B was not started. A remains at the native gate."));
    }
    if record[3] != b'1' || problem != 0 || label > 4096 || bytes > 4096 || record.len() != 36 + label + bytes {
        return Err("LDI capture was incomplete or invalid; B was not started. A remains at the native gate.".into());
    }
    Ok(())
}

pub(crate) fn on_variables(app: &AppHandle, label: &str, pgid: i32, variables: &[Value]) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && pair.phase == "reading" && pair.held)
    else {
        return;
    };
    if pair.binding.call.kind == CallKind::Utf8Bytes {
        let binding = pair.binding.clone();
        let cancelled = pair.partner_cancelled.clone();
        let armed = arm_interposer(app, pair);
        let (capture, token, tid, pid) = match armed {
            Ok(armed) => armed,
            Err(error) => {
                pair.phase = "failed".into();
                pair.error = Some(format!("Could not arm the typed interposer: {error}. A remains held."));
                notify(app, pair);
                return;
            }
        };
        drop(state);
        let app = app.clone();
        let label = label.to_string();
        tauri::async_runtime::spawn(async move {
            let result = tauri::async_runtime::spawn_blocking({
                let app = app.clone();
                let binding = binding.clone();
                let cancelled = cancelled.clone();
                let capture = capture.clone();
                move || wait_and_build_interposer_driver(&app, &binding, token, tid, pid, &capture, cancelled)
            }).await.map_err(|error| error.to_string()).and_then(|value| value)
            .and_then(|(driver, library, completion)| {
                check_launch(&app, &binding.blue.partner_label, Some(token))?;
                super::debug::launch_prepared(app.clone(), binding.blue.partner_label.clone(), "cpp",
                    PathBuf::from(&binding.selection.spec.cwd), binding.selection.solution.clone(),
                    driver, vec![library.to_string_lossy().into_owned(),
                        capture.file.to_string_lossy().into_owned(), completion.to_string_lossy().into_owned(),
                        token.to_string()], binding.selection.spec.env.clone(), vec![binding.native.clone()],
                    None, Some(token), None)
            });
            if let Err(error) = result {
                let manager = app.state::<LdiManager>();
                if let Ok(mut state) = manager.0.lock() {
                    if let Some(pair) = state.pairs.get_mut(&label).filter(|pair| pair.token == token && pair.held
                        && !pair.cancelled.load(Ordering::Acquire)) {
                        if pair.phase == "stopping-native" && pair.partner_cancelled.load(Ordering::Acquire) {
                            let _ = finish_abandoned_partner(&app, pair);
                        } else if pair.phase == "closing-native" && pair.partner_cancelled.load(Ordering::Acquire) {
                            let _ = finish_partner_close(&app, pair);
                        } else if error == "LDI interposer did not reach the native boundary within 15 seconds" {
                            pair.phase = "failed".into();
                            pair.error = Some(format!("{error}; stopping the pair rather than allowing an unobserved native call."));
                            notify(&app, pair);
                            drop(state);
                            super::debug::cancel_debug_by_label(&app, &label);
                            return;
                        } else {
                            pair.phase = "failed".into();
                            pair.error = Some(error.clone());
                            notify(&app, pair);
                            super::debug::emit(&app, &binding.blue.partner_label, json!({"status":"error", "text":error}));
                        }
                    }
                };
            }
        });
        return;
    }
    let result = scalar(variables, &pair.binding.call.locals[0]).and_then(|left| {
        scalar(variables, &pair.binding.call.locals[1]).map(|right| [left, right])
    });
    match result {
        Ok(values) => {
            pair.values = Some(values);
            pair.phase = "building-native".into();
        }
        Err(error) => {
            pair.phase = "failed".into();
            pair.error = Some(error);
            notify(app, pair);
            return;
        }
    }
    notify(app, pair);
    let binding = pair.binding.clone();
    let token = pair.token;
    let values = pair.values.unwrap();
    let cancelled = pair.partner_cancelled.clone();
    drop(state);
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let build = tauri::async_runtime::spawn_blocking({
            let app = app.clone();
            let binding = binding.clone();
            let cancelled = cancelled.clone();
            move || build_driver(&app, &binding, token, values, cancelled)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|value| value);
        let result = build.and_then(|(driver, library)| {
            check_launch(&app, &binding.blue.partner_label, Some(token))?;
            let completion = driver
                .parent()
                .ok_or("Driver directory is missing")?
                .join("returned.txt");
            super::debug::launch_prepared(
                app.clone(),
                binding.blue.partner_label.clone(),
                "cpp",
                PathBuf::from(&binding.selection.spec.cwd),
                binding.selection.solution.clone(),
                driver,
                vec![
                    library.to_string_lossy().into_owned(),
                    values[0].to_string(),
                    values[1].to_string(),
                    completion.to_string_lossy().into_owned(),
                ],
                binding.selection.spec.env.clone(),
                vec![binding.native.clone()],
                None,
                Some(token),
                None,
            )
        });
        if let Err(error) = result {
            let manager = app.state::<LdiManager>();
            let mut current = false;
            let mut abandoned = false;
            let mut detach_failed = false;
            if let Ok(mut state) = manager.0.lock() {
                if let Some(pair) = state.pairs.get_mut(&label).filter(|pair| {
                    pair.token == token && pair.held && !pair.cancelled.load(Ordering::Acquire)
                }) {
                    if pair.phase == "stopping-native" && pair.partner_cancelled.load(Ordering::Acquire) {
                        abandoned = finish_abandoned_partner(&app, pair).is_ok();
                    } else if pair.phase == "closing-native" && pair.partner_cancelled.load(Ordering::Acquire) {
                        match finish_partner_close(&app, pair) {
                            Ok(()) => abandoned = true,
                            Err(_) => detach_failed = true,
                        }
                    } else {
                        current = true;
                        pair.phase = "failed".into();
                        pair.error = Some(error.clone());
                        notify(&app, pair);
                    }
                }
            }
            if detach_failed {
                // B is already gone. An A that cannot be detached/resumed
                // must be stopped instead of left at an invisible hold.
                super::debug::cancel_debug_by_label(&app, &label);
            }
            if abandoned {
                super::debug::emit(&app, &binding.blue.partner_label,
                    json!({"status":"terminated", "text":"B stopped; A continues its original call."}));
            } else if current {
                super::debug::emit(
                    &app,
                    &binding.blue.partner_label,
                    json!({"status":"error", "text":error}),
                );
            }
        }
    });
}

pub(crate) fn on_inspection_error(
    app: &AppHandle,
    label: &str,
    pgid: i32,
    command: &str,
    message: &str,
) {
    if !matches!(command, "stackTrace" | "scopes" | "variables") {
        return;
    }
    let manager = app.state::<LdiManager>();
    if let Ok(mut state) = manager.0.lock() {
        if let Some(pair) = state
            .pairs
            .get_mut(label)
            .filter(|pair| pair.origin_pgid == pgid && pair.held)
        {
            pair.phase = "failed".into();
            pair.error = Some(format!(
                "Could not read the held frame: {command}: {message}. A remains held."
            ));
            notify(app, pair);
        }
    };
}

fn same_source(a: &Path, b: &Path) -> bool {
    a == b
        || a.canonicalize()
            .ok()
            .zip(b.canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}

fn shared_library(
    build: &Path,
    name: &str,
    target: Option<&str>,
    native_source: &Path,
) -> Result<PathBuf, String> {
    shared_library_for_source(build, Some(name), target, native_source)
}

pub(crate) fn shared_library_for_source(
    build: &Path, name: Option<&str>, target: Option<&str>, native_source: &Path,
) -> Result<PathBuf, String> {
    let reply = build.join(".cmake/api/v1/reply");
    let index = fs::read_dir(&reply)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("index-"))
        .max_by_key(|entry| entry.file_name())
        .ok_or("CMake did not publish its target index")?;
    let index: Value =
        serde_json::from_slice(&fs::read(index.path()).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let model_file = index["reply"]["codemodel-v2"]["jsonFile"]
        .as_str()
        .ok_or("CMake did not publish the requested target model")?;
    let model: Value = serde_json::from_slice(
        &fs::read(reply.join(model_file)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mut candidates = vec![];
    for config in model["configurations"]
        .as_array()
        .ok_or("CMake configurations are missing")?
    {
        if !matches!(config["name"].as_str(), Some("Debug" | "")) {
            continue;
        }
        for item in config["targets"]
            .as_array()
            .ok_or("CMake targets are missing")?
        {
            let info: Value = serde_json::from_slice(
                &fs::read(
                    reply.join(
                        item["jsonFile"]
                            .as_str()
                            .ok_or("CMake target file is missing")?,
                    ),
                )
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if info["type"] != "SHARED_LIBRARY"
                || target.is_some_and(|target| info["name"] != target)
            {
                continue;
            }
            let source_root = Path::new(
                model["paths"]["source"]
                    .as_str()
                    .ok_or("CMake source root is missing")?,
            );
            if !info["sources"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|source| {
                    source["compileGroupIndex"].is_number()
                        && source["path"]
                            .as_str()
                            .is_some_and(|path| same_source(&source_root.join(path), native_source))
                })
            {
                continue;
            }
            for artifact in info["artifacts"].as_array().into_iter().flatten() {
                if let Some(path) = artifact["path"].as_str() {
                    let path = build.join(path);
                    if name.map_or_else(|| path.extension().and_then(|v|v.to_str()) == Some("so"),
                        |name|path.file_name().and_then(|value| value.to_str()) == Some(&format!("lib{name}.so")))
                    {
                        candidates.push(path.canonicalize().map_err(|error| error.to_string())?);
                    }
                }
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    if candidates.len() != 1 {
        return Err(if let Some(name)=name {
            format!("LDI needs exactly one CMake SHARED_LIBRARY artifact named lib{name}.so matching the DllImport and compiling the selected native breakpoint's source. Static/ambiguous/mismatched libraries are not supported.")
        } else {"Rust Native Debugging needs one CMake SHARED_LIBRARY artifact compiling the selected export source in the selected target. Static/ambiguous/mismatched targets are not supported in this version.".into()});
    }
    Ok(candidates.remove(0))
}

pub(crate) fn argument(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].clone())
        .or_else(|| {
            args.iter()
                .find_map(|arg| arg.strip_prefix(&format!("{flag}=")).map(String::from))
        })
}

fn build_library(
    app: &AppHandle,
    binding: &Binding,
    cancelled: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let spec = &binding.selection.spec;
    if spec.args.first().map(String::as_str) != Some("--build") || spec.order.is_some() {
        return Err("LDI v1 needs a direct CMake --build Library Power slot; a native preparation plan/configure-only command is not supported yet".into());
    }
    let cwd = Path::new(&spec.cwd);
    super::native_debug::check_cmake_build(app, cwd)?;
    let build = cwd.join(argument(&spec.args, "--build").unwrap_or("build".into()));
    let query = build.join(".cmake/api/v1/query");
    fs::create_dir_all(&query).map_err(|error| error.to_string())?;
    fs::write(query.join("codemodel-v2"), "").map_err(|error| error.to_string())?;
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        cwd,
        "cmake",
        &[
            "-S".into(),
            ".".into(),
            "-B".into(),
            build.to_string_lossy().into_owned(),
            "-DCMAKE_BUILD_TYPE=Debug".into(),
        ],
        "LDI native configure",
        cancelled.clone(),
    )?;
    let target = argument(&spec.args, "--target");
    let mut args = vec![];
    let mut skip = false;
    for arg in &spec.args {
        if skip {
            skip = false;
            continue;
        }
        if arg == "--config" {
            skip = true;
            continue;
        }
        if arg.starts_with("--config=") {
            continue;
        }
        args.push(arg.clone());
    }
    let config_at = args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(args.len());
    args.splice(config_at..config_at, ["--config".into(), "Debug".into()]);
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        cwd,
        "cmake",
        &args,
        "LDI native build",
        cancelled,
    )?;
    shared_library(
        &build,
        &binding.call.library,
        target.as_deref(),
        Path::new(&binding.native.file),
    )
}

fn interposer_target_framework(cwd: &Path) -> Result<String, String> {
    let projects = fs::read_dir(cwd).map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|part| part.to_str()) == Some("csproj"))
        .collect::<Vec<_>>();
    if projects.len() != 1 { return Err("Interposer needs exactly one .csproj in the selected C# project directory".into()); }
    let source = fs::read_to_string(&projects[0]).map_err(|error| error.to_string())?;
    let tfm = regex(r"<TargetFramework>\s*(net\d+\.\d+)\s*</TargetFramework>")
        .captures(&source).map(|found| found[1].to_string())
        .ok_or("Interposer needs an explicit modern .NET TargetFramework such as net8.0")?;
    Ok(tfm)
}

fn build_interposer(
    app: &AppHandle, binding: &Binding, library: &Path, token: u64,
    cancelled: Arc<AtomicBool>,
) -> Result<InterposerPrepared, String> {
    let parent = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("ldi");
    fs::create_dir_all(&parent).map_err(|error| error.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let folder = parent.join(format!("interposer-{}-{token}-{now}", std::process::id()));
    fs::create_dir(&folder).map_err(|error| format!("Could not create a fresh LDI interposer directory: {error}"))?;
    fs::set_permissions(&folder, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())?;
    let source = include_str!("ldi_interposer_proxy.cpp.in").replace("@ENTRY_POINT@", &binding.call.entry_point);
    fs::write(folder.join("proxy.cpp"), source).map_err(|error| error.to_string())?;
    let proxy = folder.join(format!("lib{}.so", binding.call.library));
    super::debug::run_build_with_cancel(app, &binding.blue.partner_label, &folder, "c++", &[
        "-std=c++17".into(), "-O0".into(), "-g".into(), "-fPIC".into(), "-shared".into(),
        "proxy.cpp".into(), "-ldl".into(), "-o".into(), proxy.to_string_lossy().into_owned(),
    ], "LDI typed interposer build", cancelled.clone())?;
    fs::write(folder.join("StartupHook.cs"), include_str!("ldi_startup_hook.cs"))
        .map_err(|error| error.to_string())?;
    let tfm = interposer_target_framework(Path::new(&binding.origin_cwd))?;
    fs::write(folder.join("Hook.csproj"), format!(r#"<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>{tfm}</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>"#))
        .map_err(|error| error.to_string())?;
    let output = folder.join("hook");
    super::debug::run_build_with_cancel(app, &binding.blue.origin_label, &folder, "dotnet", &[
        "build".into(), "Hook.csproj".into(), "--configuration".into(), "Debug".into(),
        "--nologo".into(), "--output".into(), output.to_string_lossy().into_owned(),
    ], "LDI startup hook build", cancelled)?;
    let hook = output.join("Hook.dll");
    if !proxy.is_file() || !hook.is_file() || !library.is_file() {
        return Err("LDI interposer artifacts are missing after build".into());
    }
    Ok(InterposerPrepared { arm: folder.join("arm.txt"), ready: folder.join("hook-ready.txt"), folder, proxy, hook })
}

/// Prepare the selected real library before starting A, so the original import
/// and the reproduction have the same build. Existing managed build orders remain intact.
pub(crate) fn prepare_origin(
    app: &AppHandle,
    origin: &str,
    request: &mut super::debug::DebugRequest,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let (bindings, cancelled, token) = {
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get(origin).ok_or("LDI pair disappeared")?;
        (pair.bindings.clone(), pair.cancelled.clone(), pair.token)
    };
    let mut prepared = HashMap::new();
    let mut built = HashMap::<(String, String), PathBuf>::new();
    let mut directories = Vec::<PathBuf>::new();
    let mut typed: Option<(Binding, PathBuf, InterposerPrepared)> = None;
    for binding in &bindings {
        super::debug::emit(app, &binding.blue.partner_label, json!({"status":"building"}));
        let build_key = (binding.blue.partner_label.clone(), binding.call.library.clone());
        let library = if let Some(existing) = built.get(&build_key) {
            let spec = &binding.selection.spec;
            let build = Path::new(&spec.cwd).join(argument(&spec.args, "--build").unwrap_or("build".into()));
            let verified = shared_library(&build, &binding.call.library,
                argument(&spec.args, "--target").as_deref(), Path::new(&binding.native.file))?;
            if !same_source(existing, &verified) {
                return Err("Blue call sites resolved to different native artifacts in one library window".into());
            }
            existing.clone()
        }
            else {
                let library = build_library(app, binding, cancelled.clone())?;
                built.insert(build_key, library.clone());
                library
            };
        let directory = library.parent().ok_or("LDI library has no directory")?.to_owned();
        if !directories.contains(&directory) { directories.push(directory); }
        let interposer = if binding.call.kind == CallKind::Utf8Bytes {
            if let Some((_, existing_library, existing)) = &typed {
                if !same_source(&library, existing_library) && !same_binary(&library, existing_library)? {
                    return Err("Typed blue call sites resolved to different native artifacts".into());
                }
                Some(existing.clone())
            } else { Some(build_interposer(app, binding, &library, token, cancelled.clone())?) }
        } else { None };
        if let Some(interposer) = &interposer { typed = Some((binding.clone(), library.clone(), interposer.clone())); }
        prepared.insert(binding_key(binding), (library, interposer));
    }
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pair = state.pairs.get_mut(origin).ok_or("LDI pair disappeared")?;
    if pair.cancelled.load(Ordering::Acquire) {
        return Err("LDI session stopped".into());
    }
    pair.prepared = prepared;
    if let Some((library, interposer)) = pair.prepared.get(&binding_key(&pair.binding)).cloned() {
        pair.library = Some(library);
        pair.interposer = interposer;
    }
    let old = request
        .env
        .get("LD_LIBRARY_PATH")
        .cloned()
        .unwrap_or_default();
    let mut paths = directories.iter().map(|path| path.to_string_lossy().into_owned()).collect::<Vec<_>>();
    if !old.is_empty() { paths.push(old); }
    request.env.insert("LD_LIBRARY_PATH".into(), paths.join(":"));
    if let Some((binding, library, prepared)) = &typed {
        request.env.insert("LDI_REAL_LIBRARY".into(), library.to_string_lossy().into_owned());
        request.env.insert("LDI_PROXY_LIBRARY".into(), prepared.proxy.to_string_lossy().into_owned());
        request.env.insert("LDI_ARM_FILE".into(), prepared.arm.to_string_lossy().into_owned());
        request.env.insert("LDI_HOOK_READY".into(), prepared.ready.to_string_lossy().into_owned());
        request.env.insert("LDI_MANAGED_LIBRARY".into(), binding.call.library.clone());
        request.env.insert("LDI_MANAGED_METHOD".into(), binding.call.method.clone());
        let previous = request.env.get("DOTNET_STARTUP_HOOKS").cloned()
            .or_else(|| std::env::var("DOTNET_STARTUP_HOOKS").ok()).unwrap_or_default();
        request.env.insert("DOTNET_STARTUP_HOOKS".into(), format!("{}{}{}", prepared.hook.display(),
            if previous.is_empty() { "" } else { ":" }, previous));
    }
    notify(app, pair);
    drop(state);
    for binding in &bindings {
        super::debug::emit(app, &binding.blue.partner_label,
            json!({"status":"terminated", "text":"LDI library ready. Waiting for A's blue call-site stop."}));
    }
    Ok(())
}

fn build_driver(
    app: &AppHandle,
    binding: &Binding,
    token: u64,
    values: [i32; 2],
    cancelled: Arc<AtomicBool>,
) -> Result<(PathBuf, PathBuf), String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("LDI session stopped".into());
    }
    let library = {
        let manager = app.state::<LdiManager>();
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        state
            .pairs
            .get(&binding.blue.origin_label)
            .filter(|pair| pair.token == token)
            .and_then(|pair| pair.library.clone())
            .ok_or("The LDI stop or library changed")?
    };
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("ldi")
        .join(format!("{}-{token}", std::process::id()));
    fs::create_dir_all(folder.parent().unwrap()).map_err(|error| error.to_string())?;
    fs::create_dir(&folder)
        .map_err(|error| format!("Could not create a fresh capture folder: {error}"))?;
    let capture = json!({"version":1, "token":token.to_string(), "source":binding.blue.file,
        "line":binding.blue.line, "entryPoint":binding.call.entry_point, "signature":"cdecl(i32,i32)->i32", "library":library, "arguments":values});
    fs::write(
        folder.join("capture.json"),
        serde_json::to_vec_pretty(&capture).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(
        folder.join("driver.cpp"),
        include_str!("ldi_driver.cpp.in").replace("@ENTRY_POINT@", &binding.call.entry_point),
    )
    .map_err(|error| error.to_string())?;
    super::debug::emit(
        app,
        &binding.blue.partner_label,
        json!({"status":"building", "text":format!("LDI: {}({}, {}). A remains held. Capture: {}", binding.call.entry_point, values[0], values[1], folder.join("capture.json").display())}),
    );
    {
        let manager = app.state::<LdiManager>();
        let mut state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state
            .pairs
            .get_mut(&binding.blue.origin_label)
            .filter(|pair| {
                pair.token == token && pair.held && !pair.cancelled.load(Ordering::Acquire)
            })
            .ok_or("The LDI stop was cancelled or replaced")?;
        pair.completion = Some(folder.join("returned.txt"));
    }
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        &folder,
        "c++",
        &[
            "-std=c++17".into(),
            "-O0".into(),
            "-g".into(),
            "-fno-omit-frame-pointer".into(),
            "driver.cpp".into(),
            "-ldl".into(),
            "-o".into(),
            "driver".into(),
        ],
        "LDI driver build",
        cancelled,
    )?;
    Ok((folder.join("driver"), library))
}

fn wait_and_build_interposer_driver(
    app: &AppHandle, binding: &Binding, token: u64, tid: u32, pid: u32,
    capture: &InterposerCapture, cancelled: Arc<AtomicBool>,
) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !capture.file.is_file() {
        if cancelled.load(Ordering::Acquire) { return Err("LDI reproduction was cancelled".into()); }
        if Instant::now() >= deadline {
            return Err("LDI interposer did not reach the native boundary within 15 seconds".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
    verify_interposer_capture(&capture.file, token, tid, pid)?;
    if cancelled.load(Ordering::Acquire) { return Err("LDI reproduction was cancelled".into()); }
    let library = {
        let manager = app.state::<LdiManager>();
        let mut state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get_mut(&binding.blue.origin_label)
            .filter(|pair| pair.token == token && pair.held && !pair.cancelled.load(Ordering::Acquire))
            .ok_or("LDI hold changed before the captured call was verified")?;
        pair.phase = "building-native".into();
        pair.error = None;
        notify(app, pair);
        pair.library.clone().ok_or("LDI real library disappeared")?
    };
    let folder = capture.file.parent().ok_or("Capture directory is missing")?;
    let source = include_str!("ldi_interposer_driver.cpp.in").replace("@ENTRY_POINT@", &binding.call.entry_point);
    fs::write(folder.join("driver.cpp"), source).map_err(|error| error.to_string())?;
    let completion = folder.join("returned.txt");
    {
        let manager = app.state::<LdiManager>();
        let mut state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get_mut(&binding.blue.origin_label).filter(|pair| pair.token == token && pair.held)
            .ok_or("LDI hold changed before driver build")?;
        pair.completion = Some(completion.clone());
    }
    super::debug::run_build_with_cancel(app, &binding.blue.partner_label, folder, "c++", &[
        "-std=c++17".into(), "-O0".into(), "-g".into(), "-fno-omit-frame-pointer".into(),
        "driver.cpp".into(), "-ldl".into(), "-o".into(), "driver".into(),
    ], "LDI interposer driver build", cancelled)?;
    Ok((folder.join("driver"), library, completion))
}

pub(crate) fn with_control(
    app: &AppHandle,
    label: &str,
    action: &str,
    operation: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    for (origin, pair) in &mut state.pairs {
        if action == "stop" && origin != label
            && pair.bindings.iter().any(|binding| binding.blue.partner_label == label)
            && (pair.binding.blue.partner_label != label || !pair.held) {
            // An idle library is not a running debugger. White Stop must not
            // tear down A or another library's active reproduction.
            return Ok(());
        }
        if origin == label
            && pair.held
            && matches!(
                action,
                "continue" | "stepOver" | "stepInto" | "stepOut" | "pause"
            )
        {
            return Err(format!(
                "A is held by LDI. CS{} must finish or explicitly release this reproduction.",
                pair.binding.blue.partner_window_id
            ));
        }
        if pair.binding.blue.partner_label == label
            && pair.held
            && action == "stop"
            && matches!(pair.phase.as_str(), "stopping-native" | "closing-native")
        {
            return Ok(());
        }
        if pair.binding.blue.partner_label == label
            && pair.held
            && matches!(
                pair.phase.as_str(),
                "checking-native-stop" | "finishing-native"
            )
            && matches!(
                action,
                "continue" | "stepOver" | "stepInto" | "stepOut" | "pause"
            )
        {
            return Err("B is completing an LDI native step; wait for its frame or release".into());
        }
        if action == "stop" && origin == label {
            pair.cancelled.store(true, Ordering::Release);
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.phase = "stopped".into();
            notify(app, pair);
            if let Some(pgid) = pair.partner_pgid {
                unsafe {
                    libc::killpg(pgid, libc::SIGTERM);
                }
            }
        } else if action == "stop" && pair.binding.blue.partner_label == label && pair.held {
            let building = pair.phase == "building-native";
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.phase = "stopping-native".into();
            pair.error = None;
            notify(app, pair);
            if let Err(error) = operation() {
                pair.phase = "failed".into();
                pair.error = Some(format!("Could not stop B: {error}. A remains held."));
                notify(app, pair);
                return Err(error);
            }
            // A must not run alongside an unfinished B. The build task or
            // adapter-end callback releases it after B has actually stopped.
            if !building && pair.partner_pgid.is_none() {
                finish_abandoned_partner(app, pair)?;
            }
            return Ok(());
        }
    }
    operation()
}

fn finish_abandoned_partner(app: &AppHandle, pair: &mut Pair) -> Result<(), String> {
    if !pair.held || pair.cancelled.load(Ordering::Acquire) || pair.phase != "stopping-native" {
        return Ok(());
    }
    pair.completion = None;
    if let Err(error) = release(app, pair) {
        pair.phase = "failed".into();
        pair.error = Some(format!("B stopped, but A could not resume: {error}. A remains held."));
        notify(app, pair);
        return Err(error);
    }
    pair.phase = "abandoned".into();
    notify(app, pair);
    Ok(())
}

fn finish_partner_close(app: &AppHandle, pair: &mut Pair) -> Result<(), String> {
    if pair.cancelled.load(Ordering::Acquire) || pair.phase != "closing-native" {
        return Ok(());
    }
    // Remove the injected blue DAP marker before A can reach another call.
    // Explicit red C# markers, including one on the same line, remain.
    let partner = pair.binding.blue.partner_label.clone();
    if pair.origin_pgid > 0 {
        let locations = pair.bindings.iter().filter(|binding| binding.blue.partner_label == partner)
            .map(|binding| (binding.blue.file.clone(), binding.blue.line)).collect::<Vec<_>>();
        if let Err(error) = super::debug::disable_ldi_blue(app, &pair.binding.blue.origin_label, &locations) {
            pair.phase = "failed".into();
            pair.error = Some(format!("B closed, but the blue marker could not be detached: {error}. A remains held."));
            notify(app, pair);
            return Err(error);
        }
    }
    pair.completion = None;
    if pair.held {
        if let Err(error) = release(app, pair) {
            pair.phase = "failed".into();
            pair.error = Some(format!("B closed, but A could not resume: {error}. A remains held."));
            notify(app, pair);
            return Err(error);
        }
    }
    pair.bindings.retain(|binding| binding.blue.partner_label != partner);
    let active = pair.bindings.iter().map(binding_key).collect::<Vec<_>>();
    pair.prepared.retain(|key, _| active.contains(key));
    pair.partner_pgid = None;
    pair.partner_cancelled = Arc::new(AtomicBool::new(false));
    if let Some(binding) = pair.bindings.first().cloned() {
        pair.binding = binding;
        pair.phase = "armed".into();
    } else {
        pair.cancelled.store(true, Ordering::Release);
        pair.phase = "stopped".into();
    }
    notify(app, pair);
    Ok(())
}

/// A library viewport closing is pair detachment, not a solution-wide stop.
/// B's build/adapter is cancelled by the caller; a held A is resumed only
/// after that cancellation finishes. The binding is not rearmed without B.
pub(crate) fn partner_window_closing(app: &AppHandle, label: &str) -> Result<bool, String> {
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let Some((origin, pair)) = state.pairs.iter_mut().find(|(_, pair)| {
        pair.bindings.iter().any(|binding| binding.blue.partner_label == label)
            && !pair.cancelled.load(Ordering::Acquire)
    }) else { return Ok(false); };
    let origin = origin.clone();
    if pair.binding.blue.partner_label != label {
        let locations = pair.bindings.iter().filter(|binding| binding.blue.partner_label == label)
            .map(|binding| (binding.blue.file.clone(), binding.blue.line)).collect::<Vec<_>>();
        if pair.origin_pgid > 0 { super::debug::disable_ldi_blue(app, &origin, &locations)?; }
        pair.bindings.retain(|binding| binding.blue.partner_label != label);
        let active = pair.bindings.iter().map(binding_key).collect::<Vec<_>>();
        pair.prepared.retain(|key, _| active.contains(key));
        if let Some(blues) = state.blues.get_mut(&origin) { blues.retain(|blue| blue.partner_label != label); }
        drop(state);
        let _ = app.emit("craidd:ldi-blues", ());
        return Ok(true);
    }
    let building = pair.phase == "building-native";
    pair.partner_cancelled.store(true, Ordering::Release);
    pair.phase = "closing-native".into();
    pair.error = None;
    notify(app, pair);
    if (!pair.held || !building) && pair.partner_pgid.is_none() {
        finish_partner_close(app, pair)?;
    }
    if let Some(blues) = state.blues.get_mut(&origin) { blues.retain(|blue| blue.partner_label != label); }
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(true)
}

fn release(app: &AppHandle, pair: &mut Pair) -> Result<(), String> {
    if !pair.held || pair.cancelled.load(Ordering::Acquire) {
        return Err("This LDI hold is no longer active".into());
    }
    // Mutex stays held across the release: another control cannot slip through.
    if pair.binding.call.kind == CallKind::Utf8Bytes {
        if let Some(capture) = &pair.capture {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match fs::OpenOptions::new().write(true).custom_flags(libc::O_NONBLOCK).open(&capture.release) {
                    Ok(mut gate) => {
                        gate.write_all(b"R").map_err(|error| format!("Could not release native gate: {error}"))?;
                        break;
                    }
                    Err(error) if error.raw_os_error() == Some(libc::ENXIO) && Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => return Err(format!("The native gate could not be released: {error}")),
                }
            }
        } else {
            // An arm/setup failure left A at the managed blue stop.
            if pair.interposer.as_ref().is_some_and(|prepared| prepared.arm.exists()) {
                return Err("An interposer arm is still present; Gold Stop is required before A can continue".into());
            }
            super::debug::continue_ldi_origin(app, &pair.binding.blue.origin_label, pair.origin_pgid)?;
        }
    } else {
        super::debug::continue_ldi_origin(app, &pair.binding.blue.origin_label, pair.origin_pgid)?;
    }
    pair.held = false;
    pair.phase = "released".into();
    pair.partner_pgid = None;
    notify(app, pair);
    if let Some(window) = app.get_webview_window(&pair.binding.blue.origin_label) {
        let _ = window.set_focus();
    }
    Ok(())
}

pub(crate) fn on_exit(app: &AppHandle, label: &str, pgid: i32, code: Option<i64>) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(pair) = state.pairs.values_mut().find(|pair| {
        pair.binding.blue.partner_label == label && pair.partner_pgid == Some(pgid) && pair.held
    }) else {
        return;
    };
    if pair.phase == "stopping-native" {
        pair.partner_pgid = None;
        let _ = finish_abandoned_partner(app, pair);
        return;
    }
    if pair.phase == "closing-native" {
        pair.partner_pgid = None;
        let failed = finish_partner_close(app, pair).is_err();
        let origin = pair.binding.blue.origin_label.clone();
        drop(state);
        if failed { super::debug::cancel_debug_by_label(app, &origin); }
        return;
    }
    let returned = pair.completion.as_ref().is_some_and(|file| {
        fs::read_to_string(file).is_ok_and(|text| text.trim().parse::<i32>().is_ok())
    });
    if code == Some(0) && returned && (!pair.binding.automatic_entry || pair.native_entered)
        && !pair.cancelled.load(Ordering::Acquire)
        && !pair.partner_cancelled.load(Ordering::Acquire) {
        if let Err(error) = release(app, pair) {
            pair.phase = "failed".into();
            pair.error = Some(error);
            notify(app, pair);
        }
    } else {
        pair.phase = "failed".into();
        pair.error = Some(format!(
            "B exited with {code:?}{}; A remains held.",
            if pair.binding.automatic_entry && !pair.native_entered {
                " without reaching the verified automatic native-entry stop"
            } else if returned {
                ""
            } else {
                " without confirming a returned native call"
            }
        ));
        notify(app, pair);
    }
}

pub(crate) fn on_adapter_end(app: &AppHandle, label: &str, pgid: i32) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let mut failed_close = Vec::new();
    for (origin, pair) in &mut state.pairs {
        if origin == label && pair.origin_pgid == pgid {
            pair.cancelled.store(true, Ordering::Release);
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.origin_pgid = 0;
            pair.held = false;
            pair.phase = "stopped".into();
            notify(app, pair);
            if let Some(pgid) = pair.partner_pgid.take() {
                unsafe {
                    libc::killpg(pgid, libc::SIGTERM);
                }
            }
        } else if pair.binding.blue.partner_label == label && pair.partner_pgid == Some(pgid) {
            pair.partner_pgid = None;
            if pair.phase == "stopping-native" {
                let _ = finish_abandoned_partner(app, pair);
                continue;
            }
            if pair.phase == "closing-native" {
                if finish_partner_close(app, pair).is_err() { failed_close.push(origin.clone()); }
                continue;
            }
            if pair.held && !pair.cancelled.load(Ordering::Acquire) {
                pair.phase = "failed".into();
                pair.error = Some(
                    "B's adapter ended without a successful completion. A remains held.".into(),
                );
                notify(app, pair);
            }
        }
    }
    drop(state);
    for origin in failed_close { super::debug::cancel_debug_by_label(app, &origin); }
}

pub(crate) fn cancel(app: &AppHandle, label: &str) {
    let manager = app.state::<LdiManager>();
    let mut adapters = Vec::new();
    if let Ok(mut state) = manager.0.lock() {
        for (origin, pair) in &mut state.pairs {
            if origin == label || pair.binding.blue.partner_label == label {
                pair.cancelled.store(true, Ordering::Release);
                pair.partner_cancelled.store(true, Ordering::Release);
                pair.phase = "stopped".into();
                notify(app, pair);
                if pair.origin_pgid > 0 {
                    adapters.push((origin.clone(), pair.origin_pgid));
                }
                if let Some(pgid) = pair.partner_pgid {
                    adapters.push((pair.binding.blue.partner_label.clone(), pgid));
                }
            }
        }
    };
    // Pair cancellation is committed before any debugger can exit. A raced
    // native completion must not release A. Teardown is bounded and captures
    // owned descendants before disconnect can orphan them.
    for (owner, pgid) in adapters {
        super::debug::stop_cancelled_ldi_adapter(app, &owner, pgid);
    }
}

#[tauri::command]
pub fn abandon_ldi_reproduction(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
    partner_label: Option<String>,
) -> Result<(), String> {
    let requested_partner = partner_label.as_deref().unwrap_or(window.label());
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pair = state
        .pairs
        .values_mut()
        .find(|pair| {
            pair.binding.blue.partner_label == requested_partner
                && (pair.binding.blue.partner_label == window.label() || pair.binding.blue.origin_label == window.label())
                && pair.token.to_string() == token
                && pair.held
        })
        .ok_or("Only the current B window or its linked C# origin can release this hold")?;
    if pair.phase == "building-native" {
        return Err("Wait for the driver build to finish, or use Gold Stop".into());
    }
    pair.partner_pgid = None;
    pair.partner_cancelled.store(true, Ordering::Release);
    let partner = pair.binding.blue.partner_label.clone();
    super::debug::stop_ldi_partner(&app, &partner)?;
    release(&app, pair)?;
    pair.phase = "abandoned".into();
    notify(&app, pair);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = include_str!("../../../tests/fixtures/ldi-gate-0/Host/Program.cs");
    #[test]
    fn gui_lab_pairs_button_call_with_ordinary_cpp_library() {
        let source = include_str!("../../../workspaces/ldi-gui-lab/Gui/MainWindow.cs");
        let line = source
            .lines()
            .position(|line| line.contains("int result = NativeMath.Add(left, right);"))
            .unwrap() as u32
            + 1;
        let call = managed_call(source, line).unwrap();
        assert_eq!(call.library, "gui_math");
        assert_eq!(call.entry_point, "gui_add");
        assert_eq!(call.locals, ["left", "right"]);
        let native = include_str!("../../../workspaces/ldi-gui-lab/Native/math.cpp");
        let red = native
            .lines()
            .position(|line| line.contains("int result = left + right;"))
            .unwrap() as u32
            + 1;
        assert!(native_contains(native, red, &call.entry_point, call.kind));
    }
    #[test]
    fn interop_playground_has_two_scalar_calls_and_one_typed_call() {
        let managed = include_str!("../../../workspaces/ldi-interop-playground/Gui/MainWindow.cs");
        let scalar = include_str!("../../../workspaces/ldi-interop-playground/Native/scalar.cpp");
        let packet = include_str!("../../../workspaces/ldi-interop-playground/Native/packet.cpp");
        for (blue, red, export) in [
            ("BLUE_ADD", "RED_ADD", "demo_add"),
            ("BLUE_DIVIDE", "RED_THROW", "demo_divide"),
        ] {
            let blue_line = managed.lines().position(|line| line.contains(&format!("// {blue}"))).unwrap() as u32 + 1;
            let red_line = scalar.lines().position(|line| line.contains(&format!("// {red}"))).unwrap() as u32 + 1;
            let call = managed_call(managed, blue_line).unwrap();
            assert_eq!(call.kind, CallKind::ScalarI32);
            assert_eq!(call.entry_point, export);
            assert!(native_contains(scalar, red_line, export, call.kind));
        }
        let blue_line = managed.lines().position(|line| line.contains("// BLUE_PACKET")).unwrap() as u32 + 1;
        let red_line = packet.lines().position(|line| line.contains("// RED_PACKET")).unwrap() as u32 + 1;
        let call = managed_call(managed, blue_line).unwrap();
        assert_eq!(call.kind, CallKind::Utf8Bytes);
        assert_eq!(call.entry_point, "demo_score");
        assert!(native_contains(packet, red_line, &call.entry_point, call.kind));
        let oversized_line = managed.lines().position(|line| line.contains("// BLUE_TOO_LARGE")).unwrap() as u32 + 1;
        let oversized = managed_call(managed, oversized_line).unwrap();
        assert_eq!((&oversized.library, &oversized.method, &oversized.entry_point),
            (&call.library, &call.method, &call.entry_point),
            "both packet blues must share the one typed startup hook");
        let pointer_line = managed.lines().position(|line| line.contains("POINTER_CALL")).unwrap() as u32 + 1;
        assert!(managed_call(managed, pointer_line).is_err());
    }
    #[test]
    fn ghost_blue_candidates_are_supported_calls_not_imports_or_pointers() {
        let source = include_str!("../../../workspaces/ldi-interop-playground/Gui/MainWindow.cs");
        let candidates = candidate_managed_calls(source).unwrap();
        let exports = candidates.iter().map(|(_, call)| call.entry_point.as_str()).collect::<Vec<_>>();
        assert_eq!(exports, vec!["demo_add", "demo_divide", "demo_score", "demo_score"]);
        let declaration = source.lines().position(|line| line.contains("extern int Add")).unwrap() as u32 + 1;
        let pointer = source.lines().position(|line| line.contains("POINTER_CALL")).unwrap() as u32 + 1;
        assert!(!candidates.iter().any(|(line, _)| *line == declaration || *line == pointer));
        let scalar_args = ["--build", "build", "--target", "demo_scalar"].map(str::to_owned);
        assert!(selected_target_matches(&scalar_args, "demo_scalar"));
        assert!(!selected_target_matches(&scalar_args, "demo_packet"));
        assert!(selected_target_matches(&[], "demo_packet"));
    }
    #[test]
    fn two_native_windows_route_by_blue_call_site_not_last_selected_library() {
        let managed = include_str!("../../../workspaces/ldi-interop-playground/Gui/MainWindow.cs");
        let file = "/project/MainWindow.cs";
        let mut bindings = Vec::new();
        for (marker, partner, library) in [("// BLUE_ADD", "scalar-window", "demo_scalar"),
            ("// BLUE_PACKET", "packet-window", "demo_packet")] {
            let line = managed.lines().position(|text| text.contains(marker)).unwrap() as u32 + 1;
            let call = managed_call(managed, line).unwrap();
            assert_eq!(call.library, library);
            let native = Breakpoint { file: format!("/native/{library}.cpp"), line: 1,
                condition: None, scope: "ldi-auto-entry".into() };
            let blue = Blue { file: file.into(), line, condition: None, origin_label: "A".into(),
                partner_label: partner.into(), origin_instance: "A1".into(), partner_instance: partner.into(),
                partner_window_id: 2, entry_point: call.entry_point.clone(), library: call.library.clone(),
                method: call.method.clone(), landing: "automatic-entry".into(),
                mode: if call.kind == CallKind::Utf8Bytes { "typed-interposer" } else { "scalar" }.into(),
                locals: call.locals.clone(), warning: None, native_points: vec![], pending_restart: false };
            bindings.push(Binding { blue, call, native, automatic_entry: true,
                selection: super::super::linked_windows::LdiSelection { label: partner.into(),
                    configuration: None, profile: None,
                    instance_id: partner.into(), window_id: 2, solution: "/solution.cln".into(),
                    spec: super::super::runner::RunSpec { label: library.into(), program: "cmake".into(),
                        args: vec![], env: Default::default(), cwd: "/native".into(), linked: None, order: None } },
                origin_cwd: "/project".into(), native_source: String::new() });
        }
        assert_eq!(binding_at(&bindings, Path::new(file), bindings[0].blue.line).unwrap().blue.partner_label, "scalar-window");
        assert_eq!(binding_at(&bindings, Path::new(file), bindings[1].blue.line).unwrap().blue.partner_label, "packet-window");
        assert!(binding_at(&bindings, Path::new(file), 999).is_none());
        let active = bindings.clone();
        let mut configured = bindings.iter().map(|binding| binding.blue.clone()).collect::<Vec<_>>();
        reconcile_blue_file(&mut configured, Path::new(file), &format!("\n{managed}")).unwrap();
        assert_eq!(configured[0].line, active[0].blue.line + 1);
        assert!(binding_at(&active, Path::new(file), active[0].blue.line).is_some(),
            "save-time reconciliation must not move the running session's bindings");
        configured.clear();
        assert_eq!(active.len(), 2, "removing configured Blue does not remove an active hold");
    }
    #[test]
    fn saved_csharp_moves_unique_blue_and_removes_deleted_call() {
        let original = include_str!("../../../workspaces/ldi-interop-playground/Gui/MainWindow.cs");
        let line = original.lines().position(|text| text.contains("// BLUE_ADD")).unwrap() as u32 + 1;
        let call = managed_call(original, line).unwrap();
        let file = Path::new("/project/MainWindow.cs");
        let blue = Blue { file: file.to_string_lossy().into_owned(), line,
            condition: Some("left > 1".into()), origin_label: "A".into(), partner_label: "B".into(),
            origin_instance: "A1".into(), partner_instance: "B1".into(), partner_window_id: 2,
            entry_point: call.entry_point.clone(), library: call.library.clone(), method: call.method.clone(),
            landing: "automatic-entry".into(), mode: "scalar".into(), locals: call.locals.clone(),
            warning: None, native_points: vec![], pending_restart: false };
        let mut blues = vec![blue.clone()];
        let shifted = format!("\n{original}");
        assert!(reconcile_blue_file(&mut blues, file, &shifted).unwrap());
        assert_eq!(blues[0].line, line + 1);
        assert_eq!(blues[0].condition.as_deref(), Some("left > 1"));
        let deleted = shifted.replace("int result = NativeScalar.Add(left, right); // BLUE_ADD",
            "int result = left + right; // BLUE_ADD");
        assert!(reconcile_blue_file(&mut blues, file, &deleted).unwrap());
        assert!(blues.is_empty());
        let modified = original.replace("NativeScalar.Add(left, right)", "NativeScalar.Add(right, left)");
        let mut blues = vec![blue];
        assert!(reconcile_blue_file(&mut blues, file, &modified).unwrap());
        assert_eq!(blues.len(), 1);
        assert!(blues[0].warning.is_some());
    }
    #[test]
    fn blue_only_uses_a_unique_native_definition_not_a_header() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
            .join("workspaces/ldi-interop-playground");
        let managed = include_str!("../../../workspaces/ldi-interop-playground/Gui/MainWindow.cs");
        let selection = super::super::linked_windows::LdiSelection {
            configuration: None, profile: None,
            label: "native".into(), instance_id: "one".into(), window_id: 2,
            solution: root.join("ldi-interop-playground.cln").to_string_lossy().into_owned(),
            spec: super::super::runner::RunSpec { label: "native".into(), program: "cmake".into(),
                args: vec!["--build".into(), "build".into()], env: Default::default(),
                cwd: root.join("Native").to_string_lossy().into_owned(), linked: None, order: None },
        };
        for (marker, export, source_name) in [
            ("// BLUE_ADD", "demo_add", "scalar.cpp"),
            ("// BLUE_DIVIDE", "demo_divide", "scalar.cpp"),
            ("// BLUE_PACKET", "demo_score", "packet.cpp"),
        ] {
            let line = managed.lines().position(|text| text.contains(marker)).unwrap() as u32 + 1;
            let call = managed_call(managed, line).unwrap();
            assert_eq!(call.entry_point, export);
            let entry = native_definition(&call, &selection).unwrap();
            assert_eq!(Path::new(&entry.file).file_name().unwrap(), source_name);
            assert_eq!(entry.scope, "ldi-auto-entry");
            assert!(native_contains(&fs::read_to_string(&entry.file).unwrap(), entry.line, export, call.kind));
        }
    }
    #[test]
    fn only_a_step_from_this_native_call_into_our_driver_auto_finishes() {
        let driver = Path::new("/ldi/private/driver.cpp");
        assert!(should_finish_native_step(
            Some("step"),
            true,
            Some(driver),
            Some(driver)
        ));
        assert!(!should_finish_native_step(
            Some("breakpoint"),
            true,
            Some(driver),
            Some(driver)
        ));
        assert!(!should_finish_native_step(
            Some("step"),
            false,
            Some(driver),
            Some(driver)
        ));
        assert!(!should_finish_native_step(
            Some("step"),
            true,
            Some(Path::new("/other/driver.cpp")),
            Some(driver)
        ));
        assert!(!should_finish_native_step(
            Some("step"),
            true,
            Some(Path::new("/source/math.cpp")),
            Some(driver)
        ));
    }
    #[test]
    fn build_order_lab_pairs_ordinary_api_and_shared_library() {
        let source = include_str!("../../../workspaces/build-order-lab/Api/Program.cs");
        let line = source
            .lines()
            .position(|line| line.contains("int result = NativeMath.Add(left, right);"))
            .unwrap() as u32
            + 1;
        let call = managed_call(source, line).unwrap();
        assert_eq!(call.library, "order_math");
        assert_eq!(call.entry_point, "order_add");
        assert_eq!(call.locals, ["left", "right"]);
        let native = include_str!("../../../workspaces/build-order-lab/Native/math.cpp");
        let red = native
            .lines()
            .position(|line| line.contains("return left + right;"))
            .unwrap() as u32
            + 1;
        assert!(native_contains(native, red, &call.entry_point, call.kind));
    }
    #[test]
    fn reads_call_site_not_import_declaration() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        let call = managed_call(SOURCE, line).unwrap();
        assert_eq!(call.entry_point, "gate_add");
        assert_eq!(call.library, "gate_native");
        assert_eq!(call.locals, ["left", "right"]);
        let declaration = SOURCE
            .lines()
            .position(|line| line.contains("extern int Add"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(SOURCE, declaration).is_err());
    }
    #[test]
    fn buffer_call_requires_verified_length_and_native_shape() {
        let line = SOURCE.lines().position(|line| line.contains("BUFFER_BLUE")).unwrap() as u32 + 1;
        let call = managed_call(SOURCE, line).unwrap();
        assert_eq!(call.kind, CallKind::Utf8Bytes);
        assert_eq!(call.locals, ["label", "bytes"]);
        assert_eq!(call.entry_point, "gate_measure");
        let native = include_str!("../../../tests/fixtures/ldi-gate-0/native/measure.cpp");
        let red = native.lines().position(|line| line.contains("NATIVE_MEASURE_STOP")).unwrap() as u32 + 1;
        assert!(native_contains(native, red, "gate_measure", CallKind::Utf8Bytes));
        assert!(managed_call(&SOURCE.replace("(nuint)bytes.Length", "(nuint)other.Length"), line).is_err());
    }
    #[test]
    fn interposer_record_never_launches_b_for_wrong_identity_or_unsupported_input() {
        let mut record = b"LDI1".to_vec();
        record.extend_from_slice(&0x3155424cu32.to_le_bytes());
        record.extend_from_slice(&42u64.to_le_bytes());
        record.extend_from_slice(&100u32.to_le_bytes());
        record.extend_from_slice(&101u32.to_le_bytes());
        record.extend_from_slice(&3u32.to_le_bytes());
        record.extend_from_slice(&2u32.to_le_bytes());
        record.extend_from_slice(&0u32.to_le_bytes());
        record.extend_from_slice(b"Car\x01\x02");
        assert!(verify_interposer_record(&record, 42, 101, 100).is_ok());
        assert!(verify_interposer_record(&record, 43, 101, 100).is_err());
        assert!(verify_interposer_record(&record, 42, 102, 100).is_err());
        record[3] = b'E';
        record.truncate(36);
        record[24..28].copy_from_slice(&0u32.to_le_bytes());
        record[28..32].copy_from_slice(&0u32.to_le_bytes());
        record[32..36].copy_from_slice(&2u32.to_le_bytes());
        assert!(verify_interposer_record(&record, 42, 101, 100).unwrap_err().contains("non-reproducible"));
    }
    #[test]
    fn rejects_inline_producers_and_wrong_abi() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("UNSUPPORTED_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(SOURCE, line).is_err());
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(
            &SOURCE.replace("CallingConvention.Cdecl", "CallingConvention.StdCall"),
            line
        )
        .is_err());
    }
    #[test]
    fn commented_imports_and_exports_cannot_pair() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(
            &SOURCE.replace(
                "[DllImport(\"gate_native\", EntryPoint = \"gate_add\"",
                "// [DllImport(\"gate_native\", EntryPoint = \"gate_add\""
            ),
            line
        )
        .is_err());
        assert!(!native_contains(
            "/* extern \"C\" int fake(int a, int b) { return a; } */",
            1,
            "fake", CallKind::ScalarI32
        ));
    }
    #[test]
    fn native_breakpoint_must_be_in_export_body() {
        let source = include_str!("../../../tests/fixtures/ldi-gate-0/native/real.cpp");
        let line = source
            .lines()
            .position(|line| line.contains("NATIVE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(native_contains(source, line, "gate_add", CallKind::ScalarI32));
        assert!(!native_contains(source, 1, "gate_add", CallKind::ScalarI32));
        assert!(!native_contains(source, line, "Add", CallKind::ScalarI32));
    }
    #[test]
    fn scalar_reads_only_unambiguous_i32_data() {
        let value =
            json!({"name":"left", "type":"int", "value":"-2147483648", "variablesReference":0});
        assert_eq!(scalar(&[value.clone()], "left").unwrap(), i32::MIN);
        assert!(scalar(&[value.clone(), value.clone()], "left").is_err());
        assert!(scalar(
            &[json!({"name":"left", "type":"int", "value":"2147483648"})],
            "left"
        )
        .is_err());
        assert!(scalar(
            &[json!({"name":"left", "type":"string", "value":"20"})],
            "left"
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires CMake and a C++ compiler"]
    fn production_driver_and_cmake_artifact_with_real_tools() {
        use std::process::Command;
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("tests/fixtures/ldi-gate-0");
        let folder = std::env::temp_dir().join(format!(
            "craidd-ldi-driver-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&folder).unwrap();
        let build = folder.join("build");
        fs::create_dir_all(build.join(".cmake/api/v1/query")).unwrap();
        fs::write(build.join(".cmake/api/v1/query/codemodel-v2"), "").unwrap();
        assert!(Command::new("cmake")
            .args([
                "-S",
                root.to_str().unwrap(),
                "-B",
                build.to_str().unwrap(),
                "-DCMAKE_BUILD_TYPE=Debug"
            ])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("cmake")
            .args(["--build", build.to_str().unwrap()])
            .status()
            .unwrap()
            .success());
        let native_source = root.join("native/real.cpp");
        let library =
            shared_library(&build, "gate_native", Some("gate_native"), &native_source).unwrap();
        assert!(shared_library(&build, "wrong_import", None, &native_source).is_err());
        assert!(
            shared_library(&build, "gate_native", Some("wrong_target"), &native_source).is_err()
        );
        assert!(shared_library(
            &build,
            "gate_native",
            None,
            &root.join("driver/main.cpp.in")
        )
        .is_err());
        fs::write(
            folder.join("driver.cpp"),
            include_str!("ldi_driver.cpp.in").replace("@ENTRY_POINT@", "gate_add"),
        )
        .unwrap();
        assert!(Command::new("c++")
            .current_dir(&folder)
            .args([
                "-std=c++17",
                "-g",
                "-O0",
                "driver.cpp",
                "-ldl",
                "-o",
                "driver"
            ])
            .status()
            .unwrap()
            .success());
        for (left, right, expected) in [
            (20, 22, 42),
            (-7, 4, -3),
            (i32::MAX, -1, i32::MAX - 1),
            (i32::MIN, 1, i32::MIN + 1),
        ] {
            let completed = folder.join(format!("returned-{left}.txt"));
            let output = Command::new(folder.join("driver"))
                .args([
                    library.to_str().unwrap(),
                    &left.to_string(),
                    &right.to_string(),
                    completed.to_str().unwrap(),
                ])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert!(
                String::from_utf8_lossy(&output.stdout).contains(&format!("returned {expected}"))
            );
            assert!(String::from_utf8_lossy(&output.stderr).contains("count=1"));
            assert_eq!(
                fs::read_to_string(completed).unwrap().trim(),
                expected.to_string()
            );
        }
        let bad_input = Command::new(folder.join("driver"))
            .args([
                library.to_str().unwrap(),
                "2147483648",
                "1",
                folder.join("bad-result.txt").to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert_eq!(bad_input.code(), Some(64));
        assert!(!folder.join("bad-result.txt").exists());
        fs::write(folder.join("zero.cpp"), "#include <cstdint>\n#include <cstdlib>\nextern \"C\" int32_t gate_add(int32_t, int32_t) { std::exit(0); }\n").unwrap();
        assert!(Command::new("c++")
            .current_dir(&folder)
            .args(["-shared", "-fPIC", "zero.cpp", "-o", "zero.so"])
            .status()
            .unwrap()
            .success());
        let zero = Command::new(folder.join("driver"))
            .args([
                folder.join("zero.so").to_str().unwrap(),
                "20",
                "22",
                folder.join("zero-result.txt").to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(zero.status.success(), "callee exited zero");
        assert!(
            !folder.join("zero-result.txt").exists(),
            "zero exit is not proof that the function returned"
        );
        assert!(zero.stdout.is_empty());
        // Exact private directory, created above; never remove fixture/user sources.
        fs::remove_dir_all(folder).unwrap();
    }
}
