//! Configuration inference.
//!
//! Given a solution and each project's manifests, propose a list of
//! Configurations. Inferred entries carry `origin = "inferred"` and are
//! never written to .cln — they exist for the session so the toolbar has
//! something sensible to show before the user has authored their own.
//!
//! The rules are deliberately conservative. An inference fires only when
//! the evidence is strong. When evidence is weak or absent, we return
//! nothing for that tier — the toolbar falls to State 0, and the user
//! writes their own Configuration.

use crate::types::{ConfigEntry, CraiddProject, CraiddSolution, Profile};
use super::manifests::Manifest;

fn package_manager(manifest: &Manifest) -> &'static str {
    if let Some(declared) = manifest.values.get("packageManager").and_then(|value| value.as_str()) {
        for manager in ["npm", "pnpm", "yarn", "bun"] {
            if declared == manager || declared.starts_with(&format!("{manager}@")) {
                return manager;
            }
        }
    }
    match manifest.values.get("lockfile").and_then(|value| value.as_str()) {
        Some("pnpm-lock.yaml") => "pnpm",
        Some("yarn.lock") => "yarn",
        Some("bun.lock") | Some("bun.lockb") => "bun",
        _ => "npm",
    }
}

/// Extract the value at a JSON pointer from a Manifest's `values`,
/// ignoring case on the top-level key.
fn str_at(values: &serde_json::Value, key: &str) -> Option<String> {
    values.get(key).and_then(|v| v.as_str()).map(String::from)
}

fn obj_at<'a>(values: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    values.get(key).and_then(|v| v.as_object())
}

fn array_at<'a>(values: &'a serde_json::Value, key: &str) -> Option<&'a Vec<serde_json::Value>> {
    values.get(key).and_then(|v| v.as_array())
}

/// Return the ConfigEntries inferred from a solution's projects.
///
/// Tier 1 — Solution Default:
///   A single entry for the whole solution, when the evidence composes.
///   Currently recognized:
///     * Rust + TypeScript where the TS package.json exposes `scripts.tauri`
///       → "npm run tauri dev" (the Tauri polyglot case)
///
/// Tier 2 — Per-project Defaults:
///   One entry per project that has an unambiguous manifest.
///     * cargo manifest with a `bin` → "cargo build"
///     * npm manifest with `scripts.dev` → "npm run dev"
///     * csproj with OutputType=Exe → "dotnet build"
///     * CMakeLists.txt with add_executable → "cmake --build ."
#[tauri::command]
pub fn infer_configs(solution: CraiddSolution) -> Result<Vec<ConfigEntry>, String> {
    let mut out: Vec<ConfigEntry> = Vec::new();

    // ── Tier 1: Solution Default ─────────────────────────────
    if let Some(default) = infer_solution_default(&solution) {
        out.push(default);
    }

    // ── Tier 2: Per-project Defaults ─────────────────────────
    for project in &solution.projects {
        if project.missing { continue; }
        if let Some(entry) = infer_project_default(project) {
            if entry.method.as_deref() == Some("dotnet") && entry.kind == "run" {
                let mut build = entry.clone();
                build.name = format!("{}: dotnet build", project.name);
                build.kind = "build".into();
                build.command = Some("dotnet build".into());
                out.push(build);
            }
            out.push(entry);
        }
    }

    Ok(out)
}

fn infer_solution_default(solution: &CraiddSolution) -> Option<ConfigEntry> {
    // The Tauri signature:
    //   - at least one Rust project with a Cargo.toml declaring a bin
    //   - at least one TS/JS project whose package.json exposes scripts.tauri
    let mut rust_project: Option<&CraiddProject> = None;
    let mut ts_project: Option<&CraiddProject> = None;
    let mut tauri_script = false;
    let mut ts_manager = "npm";

    for p in &solution.projects {
        if p.missing { continue; }
        let lang = p.language.as_deref().unwrap_or("");

        if lang == "rust" {
            let has_bin = p.manifests.iter().any(|m| {
                m.kind == "cargo"
                    && array_at(&m.values, "bins").map(|b| !b.is_empty()).unwrap_or(false)
            });
            if has_bin { rust_project = Some(p); }
        }

        if lang == "typescript" || lang == "javascript" {
            for m in &p.manifests {
                if m.kind != "npm" { continue; }
                if let Some(scripts) = obj_at(&m.values, "scripts") {
                    if scripts.get("tauri").is_some() {
                        tauri_script = true;
                        ts_project = Some(p);
                        ts_manager = package_manager(m);
                    }
                }
            }
        }
    }

    if tauri_script && rust_project.is_some() {
        // Both halves present. Propose the composed default.
        // The target is the TS project, whose folder is where
        // `npm run tauri dev` should execute.
        let ts = ts_project?;
        return Some(ConfigEntry {
            name: "Tauri Dev".into(),
            kind: "run".into(),
            target: ts.path.clone(),
            method: Some("npm".into()),
            command: Some(format!("{ts_manager} run tauri dev")),
            cwd: None, // runner resolves to the target's folder
            origin: "inferred".into(),
            profiles: vec![],
            default_profile: None,
        });
    }

    None
}

fn infer_project_default(project: &CraiddProject) -> Option<ConfigEntry> {
    for m in &project.manifests {
        match m.kind.as_str() {
            "cargo" => {
                let has_bin = array_at(&m.values, "bins")
                    .map(|b| !b.is_empty())
                    .unwrap_or(false);
                let name = project.name.clone();
                return Some(ConfigEntry {
                    name: if has_bin {
                        format!("{name}: cargo build")
                    } else {
                        format!("{name}: cargo check (library)")
                    },
                    kind: "build".into(),
                    target: project.path.clone(),
                    method: Some("cargo".into()),
                    command: Some(if has_bin {
                        "cargo build".into()
                    } else {
                        "cargo check".into()
                    }),
                    cwd: None,
                    origin: "inferred".into(),
                    profiles: profiles_for_cargo(project),
                    default_profile: Some("debug".into()),
                });
            }
            "npm" => {
                let manager = package_manager(m);
                let scripts = obj_at(&m.values, "scripts");
                let dev_script = scripts
                    .and_then(|s| s.get("dev"))
                    .and_then(|v| v.as_str());
                let name = project.name.clone();
                if let Some(_dev) = dev_script {
                    return Some(ConfigEntry {
                        name: format!("{name}: {manager} run dev"),
                        kind: "run".into(),
                        target: project.path.clone(),
                        method: Some("npm".into()),
                        command: Some(format!("{manager} run dev")),
                        cwd: None,
                        origin: "inferred".into(),
                        profiles: vec![],
                        default_profile: None,
                    });
                }
            }
            "dotnet" => {
                let output_type = str_at(&m.values, "outputType").unwrap_or_default();
                let sdk = str_at(&m.values, "sdk").unwrap_or_default();
                let name = project.name.clone();
                let profiles = profiles_for_dotnet(project);
                let default_profile = profiles.iter()
                    .find(|profile| profile.name == "Debug")
                    .or_else(|| profiles.first())
                    .map(|profile| profile.name.clone());
                if output_type == "Exe" || output_type == "WinExe" || sdk == "Microsoft.NET.Sdk.Web" {
                    return Some(ConfigEntry {
                        name: format!("{name}: dotnet run"),
                        kind: "run".into(),
                        target: project.path.clone(),
                        method: Some("dotnet".into()),
                        command: Some("dotnet run".into()),
                        cwd: None,
                        origin: "inferred".into(),
                        profiles,
                        default_profile,
                    });
                } else {
                    return Some(ConfigEntry {
                        name: format!("{name}: dotnet build"),
                        kind: "build".into(),
                        target: project.path.clone(),
                        method: Some("dotnet".into()),
                        command: Some("dotnet build".into()),
                        cwd: None,
                        origin: "inferred".into(),
                        profiles,
                        default_profile,
                    });
                }
            }
            "cmake" => {
                let has_executable = array_at(&m.values, "executables")
                    .map(|e| !e.is_empty())
                    .unwrap_or(false);
                let name = project.name.clone();
                return Some(ConfigEntry {
                    name: format!("{name}: cmake build"),
                    kind: if has_executable { "run".into() } else { "build".into() },
                    target: project.path.clone(),
                    method: Some("cmake".into()),
                    command: Some("cmake --build build".into()),
                    cwd: None,
                    origin: "inferred".into(),
                    profiles: profiles_for_cmake(),
                    default_profile: Some("Debug".into()),
                });
            }
            _ => {}
        }
    }
    None
}



// ── PROFILE HELPERS ───────────────────────────────────────

/// Cargo's profile set: always includes `debug` and `release`; any
/// `[profile.<name>]` table in Cargo.toml adds a custom profile.
fn profiles_for_cargo(project: &CraiddProject) -> Vec<Profile> {
    let mut out = vec![
        Profile {
            name: "debug".into(),
            args: vec![],
            env: std::collections::BTreeMap::new(),
            description: Some("cargo default".into()),
        },
        Profile {
            name: "release".into(),
            args: vec!["--release".into()],
            env: std::collections::BTreeMap::new(),
            description: None,
        },
    ];
    // Custom [profile.*] tables. Read from the manifest values if we
    // ever carry them; for now, keep the standard two.
    let _ = project;
    out.shrink_to_fit();
    out
}

/// .NET's configuration set: read from <Configurations> in the .csproj
/// if declared; otherwise the default Debug/Release pair.
fn profiles_for_dotnet(project: &CraiddProject) -> Vec<Profile> {
    let names = project.manifests.iter()
        .find(|manifest| manifest.kind == "dotnet")
        .and_then(|manifest| str_at(&manifest.values, "configurations"))
        .map(|declared| declared.split(';')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>())
        .filter(|names| !names.is_empty())
        .unwrap_or_else(|| vec!["Debug".into(), "Release".into()]);

    names.into_iter().map(|name| Profile {
        args: vec!["--configuration".into(), name.clone()],
        name,
        env: std::collections::BTreeMap::new(),
        description: None,
    }).collect()
}

/// CMake's build types. Standard four; CMakePresets.json overrides
/// these when present, in a follow-up push.
fn profiles_for_cmake() -> Vec<Profile> {
    vec![
        Profile { name: "Debug".into(),           args: vec!["--config".into(), "Debug".into()],           env: std::collections::BTreeMap::new(), description: None },
        Profile { name: "Release".into(),         args: vec!["--config".into(), "Release".into()],         env: std::collections::BTreeMap::new(), description: None },
        Profile { name: "RelWithDebInfo".into(),  args: vec!["--config".into(), "RelWithDebInfo".into()],  env: std::collections::BTreeMap::new(), description: None },
        Profile { name: "MinSizeRel".into(),      args: vec!["--config".into(), "MinSizeRel".into()],      env: std::collections::BTreeMap::new(), description: None },
    ]
}

/// Python has no built-in profile concept. Inference produces none;
/// the user extends the set when they want custom variants.
fn profiles_for_python() -> Vec<Profile> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::manifests::Manifest;

    fn mk_project(name: &str, lang: &str, path: &str, manifests: Vec<Manifest>) -> CraiddProject {
        CraiddProject {
            id: name.into(),
            name: name.into(),
            language: Some(lang.into()),
            root: ".".into(),
            kind: "application".into(),
            path: path.into(),
            folder: ".".into(),
            config_enabled: false,
            config_name: None,
            config_directory: None,
            main_include: vec![],
            main_exclude: vec![],
            config_include: vec![],
            config_exclude: vec![],
            manifests,
            missing: false,
            external: false,
        }
    }

    fn mk_manifest(kind: &str, values: serde_json::Value) -> Manifest {
        Manifest {
            kind: kind.into(),
            path: format!("/tmp/{kind}"),
            folder: "/tmp".into(),
            values,
        }
    }

    #[test]
    fn tauri_signature_produces_solution_default() {
        let rust = mk_project("src-tauri", "rust", "src-tauri/src-tauri.craidd",
            vec![mk_manifest("cargo", serde_json::json!({ "bins": ["tauri-app"] }))]);
        let ts = mk_project("src", "typescript", "src/src.craidd",
            vec![mk_manifest("npm", serde_json::json!({
                "scripts": { "dev": "vite", "tauri": "tauri" },
                "packageManager": "pnpm@9.0.0"
            }))]);
        let solution = CraiddSolution {
            name: "tauri-app".into(),
            root: "/tmp".into(),
            projects: vec![rust, ts],
            build: vec![],
            run_default: None,
            debug_default: None,
            autostart: vec![],
            default_project: None,
            default_build: None,
            configs: vec![],
            default_config: None,
            inferred_configs: vec![],
        };
        let inferred = infer_configs(solution).unwrap();
        assert!(inferred.iter().any(|c| c.name == "Tauri Dev" && c.command.as_deref() == Some("pnpm run tauri dev")));
    }

    #[test]
    fn lone_rust_project_produces_per_project_default() {
        let rust = mk_project("src-tauri", "rust", "src-tauri/src-tauri.craidd",
            vec![mk_manifest("cargo", serde_json::json!({ "bins": ["tauri-app"] }))]);
        let solution = CraiddSolution {
            name: "solo".into(),
            root: "/tmp".into(),
            projects: vec![rust],
            build: vec![],
            run_default: None,
            debug_default: None,
            autostart: vec![],
            default_project: None,
            default_build: None,
            configs: vec![],
            default_config: None,
            inferred_configs: vec![],
        };
        let inferred = infer_configs(solution).unwrap();
        assert_eq!(inferred.len(), 1);
        assert_eq!(inferred[0].method.as_deref(), Some("cargo"));
    }

    #[test]
    fn web_sdk_without_output_type_can_run() {
        let project = mk_project("Api", "csharp", "Api/api.craidd",
            vec![mk_manifest("dotnet", serde_json::json!({
                "sdk": "Microsoft.NET.Sdk.Web",
                "configurations": "Debug;Release"
            }))]);
        let config = infer_project_default(&project).unwrap();
        assert_eq!(config.kind, "run");
        assert_eq!(config.profiles.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["Debug", "Release"]);
    }

    #[test]
    fn dotnet_profiles_follow_declared_configurations() {
        let project = mk_project("Api", "csharp", "Api/api.craidd",
            vec![mk_manifest("dotnet", serde_json::json!({
                "sdk": "Microsoft.NET.Sdk.Web",
                "configurations": "Staging;Release"
            }))]);
        let config = infer_project_default(&project).unwrap();
        assert_eq!(config.default_profile.as_deref(), Some("Staging"));
        assert_eq!(config.profiles[1].args, vec!["--configuration", "Release"]);
    }
}
