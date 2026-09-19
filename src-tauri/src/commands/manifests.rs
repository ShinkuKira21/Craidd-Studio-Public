//! Manifest reading.
//!
//! A "manifest" here means a file that a project's ecosystem wrote to describe
//! itself to its own build tool:
//!
//!   Rust             Cargo.toml
//!   TypeScript/JS    package.json
//!   C#               *.csproj
//!   C++ (CMake)      CMakeLists.txt
//!
//! Craidd reads these files. It never writes them. It never mirrors their
//! contents into .craidd or .cln. The parsed result lives in memory for the
//! session and is refreshed alongside the project's tree.
//!
//! Reads happen against a project's *resolved folder* (a folder that lives at
//! or below the loaded .cln's root). Nothing is read from above that folder.
//! No ascent, no search.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Loose, permissive representation of one manifest file.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub kind: String,               // "cargo" | "npm" | "dotnet" | "cmake"
    pub path: String,               // absolute path to the manifest file
    pub folder: String,             // absolute path to the folder containing it
    pub values: serde_json::Value,  // loosely-typed extracted fields
}

#[tauri::command]
pub fn read_manifests(folder: String) -> Result<Vec<Manifest>, String> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();

    let cargo_path = dir.join("Cargo.toml");
    if cargo_path.is_file() {
        out.push(parse_cargo(&cargo_path));
    }

    let pkg_path = dir.join("package.json");
    if pkg_path.is_file() {
        out.push(parse_package_json(&pkg_path));
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("csproj") {
                out.push(parse_csproj(&p));
                break;
            }
        }
    }

    let cmake_path = dir.join("CMakeLists.txt");
    if cmake_path.is_file() {
        out.push(parse_cmakelists(&cmake_path));
    }

    Ok(out)
}

fn folder_of(path: &Path) -> String {
    path.parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn read_text(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

// ── CARGO ─────────────────────────────────────────────────

fn parse_cargo(path: &Path) -> Manifest {
    let folder = folder_of(path);
    let path_str = path.to_string_lossy().into_owned();

    let values = match read_text(path).and_then(|t| t.parse::<toml::Value>().ok()) {
        Some(toml) => {
            let package = toml.get("package");
            let bins: Vec<serde_json::Value> = toml
                .get("bin")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|b| {
                            b.get("name")
                                .and_then(|n| n.as_str())
                                .map(|n| serde_json::Value::String(n.into()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let has_lib = toml.get("lib").is_some();
            let package_name = package
                .and_then(|p| p.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let dep_keys: Vec<serde_json::Value> = toml
                .get("dependencies")
                .and_then(|v| v.as_table())
                .map(|t| t.keys().map(|k| serde_json::Value::String(k.clone())).collect())
                .unwrap_or_default();

            // Cargo's own rule: with no explicit [[bin]], a binary named
            // after package.name is produced if src/main.rs exists next
            // to Cargo.toml. We read Cargo's convention, not our own.
            let has_main_rs = path
                .parent()
                .map(|dir| dir.join("src").join("main.rs").is_file())
                .unwrap_or(false);

            let effective_bins: Vec<serde_json::Value> =
                if !bins.is_empty() {
                    bins.clone()
                } else if has_main_rs {
                    match &package_name {
                        Some(n) => vec![serde_json::Value::String(n.clone())],
                        None => vec![],
                    }
                } else {
                    vec![]
                };

            serde_json::json!({
                "packageName": package_name,
                "packageVersion": package
                    .and_then(|p| p.get("version"))
                    .and_then(|v| v.as_str()),
                "edition": package
                    .and_then(|p| p.get("edition"))
                    .and_then(|v| v.as_str()),
                "hasLib": has_lib,
                "hasMainRs": has_main_rs,
                "bins": effective_bins,
                "defaultRun": package
                    .and_then(|p| p.get("default-run"))
                    .and_then(|v| v.as_str()),
                "dependencyNames": dep_keys,
            })
        }
        None => serde_json::json!({ "parseError": true }),
    };

    Manifest {
        kind: "cargo".into(),
        path: path_str,
        folder,
        values,
    }
}

// ── NPM ───────────────────────────────────────────────────

fn parse_package_json(path: &Path) -> Manifest {
    let folder = folder_of(path);
    let path_str = path.to_string_lossy().into_owned();

    let values = match read_text(path).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
        Some(json) => {
            let scripts = json.get("scripts").cloned().unwrap_or(serde_json::json!({}));
            let lockfile = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json"]
                .into_iter().find(|name| Path::new(&folder).join(name).is_file());
            let dep_keys: Vec<String> = json
                .get("dependencies")
                .and_then(|v| v.as_object())
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();
            let dev_dep_keys: Vec<String> = json
                .get("devDependencies")
                .and_then(|v| v.as_object())
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();

            serde_json::json!({
                "name": json.get("name").and_then(|v| v.as_str()),
                "version": json.get("version").and_then(|v| v.as_str()),
                "scripts": scripts,
                "packageManager": json.get("packageManager").and_then(|v| v.as_str()),
                "lockfile": lockfile,
                "dependencyNames": dep_keys,
                "devDependencyNames": dev_dep_keys,
            })
        }
        None => serde_json::json!({ "parseError": true }),
    };

    Manifest {
        kind: "npm".into(),
        path: path_str,
        folder,
        values,
    }
}

// ── CSHARP ────────────────────────────────────────────────

fn parse_csproj(path: &Path) -> Manifest {
    let folder = folder_of(path);
    let path_str = path.to_string_lossy().into_owned();

    let values = match read_text(path) {
        Some(text) => {
            let sdk = extract_csproj_sdk(&text);
            let output_type = extract_xml_tag_text(&text, "OutputType");
            let target_framework = extract_xml_tag_text(&text, "TargetFramework");
            let configurations = extract_xml_tag_text(&text, "Configurations");
            let platforms = extract_xml_tag_text(&text, "Platforms");
            let platform_target = extract_xml_tag_text(&text, "PlatformTarget");
            let runtime_identifier = extract_xml_tag_text(&text, "RuntimeIdentifier");
            let package_refs = extract_xml_tag_attrs(&text, "PackageReference", "Include");
            let project_refs = extract_xml_tag_attrs(&text, "ProjectReference", "Include");
            let native_libs = extract_xml_tag_attrs(&text, "NativeLibrary", "Include");

            serde_json::json!({
                "sdk": sdk,
                "outputType": output_type,
                "targetFramework": target_framework,
                "configurations": configurations,
                "platforms": platforms,
                "platformTarget": platform_target,
                "runtimeIdentifier": runtime_identifier,
                "packageReferences": package_refs,
                "projectReferences": project_refs,
                "nativeLibraries": native_libs,
            })
        }
        None => serde_json::json!({ "parseError": true }),
    };

    Manifest {
        kind: "dotnet".into(),
        path: path_str,
        folder,
        values,
    }
}

fn extract_csproj_sdk(text: &str) -> Option<String> {
    let idx = text.find("<Project")?;
    let after = &text[idx..];
    let sdk_idx = after.find("Sdk=")?;
    let tail = &after[sdk_idx + 4..];
    let quote = tail.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &tail[1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn extract_xml_tag_text(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(text[start..end].trim().to_string())
}

fn extract_xml_tag_attrs(text: &str, tag: &str, attr: &str) -> Vec<String> {
    let needle = format!("<{tag}");
    let needle_attr = format!("{attr}=");
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(idx) = text[cursor..].find(&needle) {
        let abs = cursor + idx;
        let after = &text[abs + needle.len()..];
        let first = after.chars().next();
        if !matches!(first, Some(c) if c.is_whitespace() || c == '>') {
            cursor = abs + needle.len();
            continue;
        }
        let close_gt = after.find('>').unwrap_or(after.len());
        let inner = &after[..close_gt];
        if let Some(attr_idx) = inner.find(&needle_attr) {
            let tail = &inner[attr_idx + needle_attr.len()..];
            if let Some(quote) = tail.chars().next() {
                if quote == '"' || quote == '\'' {
                    let rest = &tail[1..];
                    if let Some(end) = rest.find(quote) {
                        out.push(rest[..end].to_string());
                    }
                }
            }
        }
        cursor = abs + needle.len();
    }
    out
}

// ── CMAKE ─────────────────────────────────────────────────

fn parse_cmakelists(path: &Path) -> Manifest {
    let folder = folder_of(path);
    let path_str = path.to_string_lossy().into_owned();

    let values = match read_text(path) {
        Some(text) => {
            let project_name = extract_cmake_first_arg(&text, "project");
            let executables = extract_cmake_all_first_args(&text, "add_executable");
            let libraries = extract_cmake_all_first_args(&text, "add_library");
            let cxx_standard = extract_cmake_set_value(&text, "CMAKE_CXX_STANDARD");

            serde_json::json!({
                "projectName": project_name,
                "executables": executables,
                "libraries": libraries,
                "cxxStandard": cxx_standard,
            })
        }
        None => serde_json::json!({ "parseError": true }),
    };

    Manifest {
        kind: "cmake".into(),
        path: path_str,
        folder,
        values,
    }
}

fn extract_cmake_first_arg(text: &str, cmd: &str) -> Option<String> {
    extract_cmake_all_first_args(text, cmd).into_iter().next()
}

fn extract_cmake_all_first_args(text: &str, cmd: &str) -> Vec<String> {
    let needle_open = format!("{cmd}(");
    let needle_open_sp = format!("{cmd} (");
    let mut out = Vec::new();
    for needle in [&needle_open, &needle_open_sp] {
        let mut cursor = 0;
        while let Some(idx) = text[cursor..].find(needle) {
            let abs = cursor + idx;
            let args_start = abs + needle.len();
            if let Some(close) = text[args_start..].find(')') {
                let args = &text[args_start..args_start + close];
                if let Some(first) = args.split_whitespace().next() {
                    let clean = first.trim_matches(|c: char| c == '"' || c == '\'').to_string();
                    if !clean.is_empty() && !out.contains(&clean) {
                        out.push(clean);
                    }
                }
                cursor = args_start + close;
            } else {
                break;
            }
        }
    }
    out
}

fn extract_cmake_set_value(text: &str, var: &str) -> Option<String> {
    let needle = format!("set({var}");
    let needle_sp = format!("set( {var}");
    for n in [&needle, &needle_sp] {
        if let Some(idx) = text.find(n) {
            let after = &text[idx + n.len()..];
            if let Some(close) = after.find(')') {
                let val = after[..close].trim().trim_matches(|c: char| c == '"' || c == '\'');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_minimal_cargo_toml() {
        let dir = std::env::temp_dir().join(format!("craidd-mf-cargo-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Cargo.toml"), "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[[bin]]\nname = \"demo\"\npath = \"src/main.rs\"\n").unwrap();
        let m = parse_cargo(&dir.join("Cargo.toml"));
        assert_eq!(m.kind, "cargo");
        assert_eq!(m.values["packageName"], "demo");
        assert_eq!(m.values["bins"][0], "demo");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auto_detects_a_bin_from_src_main_rs() {
        let dir = std::env::temp_dir().join(format!("craidd-mf-autobin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(
            dir.join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::write(dir.join("src").join("main.rs"), "fn main() {}\n").unwrap();
        let m = parse_cargo(&dir.join("Cargo.toml"));
        assert_eq!(m.values["packageName"], "demo");
        assert_eq!(m.values["hasMainRs"], true);
        assert_eq!(m.values["bins"][0], "demo");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_a_minimal_package_json() {
        let dir = std::env::temp_dir().join(format!("craidd-mf-npm-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("package.json"), r#"{"name":"demo","scripts":{"dev":"vite","tauri":"tauri"}}"#).unwrap();
        let m = parse_package_json(&dir.join("package.json"));
        assert_eq!(m.kind, "npm");
        assert_eq!(m.values["name"], "demo");
        assert_eq!(m.values["scripts"]["tauri"], "tauri");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_a_minimal_csproj() {
        let dir = std::env::temp_dir().join(format!("craidd-mf-csproj-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("demo.csproj"), r#"<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Configurations>Debug;Release;Staging</Configurations>
  </PropertyGroup>
</Project>"#).unwrap();
        let m = parse_csproj(&dir.join("demo.csproj"));
        assert_eq!(m.kind, "dotnet");
        assert_eq!(m.values["sdk"], "Microsoft.NET.Sdk");
        assert_eq!(m.values["outputType"], "Exe");
        assert_eq!(m.values["targetFramework"], "net8.0");
        assert_eq!(m.values["configurations"], "Debug;Release;Staging");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_a_minimal_cmakelists() {
        let dir = std::env::temp_dir().join(format!("craidd-mf-cmake-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\nproject(my_lib)\nset(CMAKE_CXX_STANDARD 20)\nadd_library(my_lib SHARED foo.cpp)\nadd_executable(my_app main.cpp)\n").unwrap();
        let m = parse_cmakelists(&dir.join("CMakeLists.txt"));
        assert_eq!(m.kind, "cmake");
        assert_eq!(m.values["projectName"], "my_lib");
        assert_eq!(m.values["cxxStandard"], "20");
        assert_eq!(m.values["libraries"][0], "my_lib");
        assert_eq!(m.values["executables"][0], "my_app");
        fs::remove_dir_all(&dir).unwrap();
    }
}
