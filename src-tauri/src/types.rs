use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CraiddProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub language: Option<String>,
    pub root: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub path: String,
    pub folder: String,

    #[serde(default)]
    pub config_enabled: bool,
    #[serde(default)]
    pub config_name: Option<String>,
    #[serde(default)]
    pub config_directory: Option<String>,

    #[serde(default)]
    pub main_include: Vec<String>,
    #[serde(default)]
    pub main_exclude: Vec<String>,
    #[serde(default)]
    pub config_include: Vec<String>,
    #[serde(default)]
    pub config_exclude: Vec<String>,

    /// Manifests read from the project's resolved folder. Session-only data;
    /// never written back to disk. See commands/manifests.rs.
    #[serde(default)]
    pub manifests: Vec<crate::commands::manifests::Manifest>,

    #[serde(default)]
    pub missing: bool,
    #[serde(default)]
    pub external: bool,
}

fn default_kind() -> String { "application".into() }

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildEntry {
    pub target: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CraiddSolution {
    pub name: String,
    pub root: String,
    pub projects: Vec<CraiddProject>,
    #[serde(default)]
    pub build: Vec<BuildEntry>,
    #[serde(default)]
    pub run_default: Option<String>,
    #[serde(default)]
    pub debug_default: Option<String>,
    #[serde(default)]
    pub autostart: Vec<String>,
    #[serde(default)]
    pub default_project: Option<String>,
    /// Legacy field. Kept for backward compatibility with .cln files
    /// written before Phase 2.3.3. Read, never written.
    #[serde(default)]
    pub default_build: Option<String>,

    /// Named Configurations declared in .cln, under [[config]].
    #[serde(default)]
    pub configs: Vec<ConfigEntry>,

    /// The name of the default Configuration.
    #[serde(default)]
    pub default_config: Option<String>,

    /// Inferred Configurations, computed at load time from the solution's
    /// projects and their manifests. Session-only; never written to .cln.
    /// The toolbar prefers a user config of the same name, otherwise
    /// shows these as suggested entries.
    #[serde(default)]
    pub inferred_configs: Vec<ConfigEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AncestorInfo {
    pub cln_path: String,
    pub cln_name: String,
    pub solution_name: String,
}


/// A loaded solution plus the absolute path to the .cln file that produced it.
/// `load_solution` / `load_solution_named` return this so the frontend never
/// has to reconstruct the path from a name — which is how the anchor bug
/// (rootPath above the loaded .cln's folder) got introduced.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolutionWithPath {
    pub solution: CraiddSolution,
    pub cln_path: String,
}


/// One named Configuration in a solution.
///
/// A Configuration is what the toolbar's dropdown shows: a named thing
/// you can build, run, debug, or test. Stage 2.3.3 handles `run` and
/// `build` kinds. `debug` and `test` are reserved for later phases and
/// will extend this struct (adapter, port, launch vs attach) when they
/// land.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub name: String,
    /// Inference-only metadata for a solution-level recommendation.
    #[serde(default)]
    pub best_fit: bool,
    #[serde(default)]
    pub related_projects: Vec<String>,
    #[serde(default)]
    pub slots: Option<ConfigSlots>,
    /// "run" | "build" | "debug" | "test"
    #[serde(default = "default_config_kind")]
    pub kind: String,
    /// Path to the target .craidd, relative to the solution root.
    /// "." means the whole solution.
    #[serde(default = "default_config_target")]
    pub target: String,
    /// Tool category: "cargo" | "npm" | "dotnet" | "cmake" | "shell" | ...
    /// Optional; if absent, the runner falls back to reading the target
    /// project's manifest.
    #[serde(default)]
    pub method: Option<String>,
    /// The literal command to run. If absent, the runner derives one
    /// from method + manifest. If present, this overrides everything.
    #[serde(default)]
    pub command: Option<String>,
    /// Working directory relative to the solution root.
    /// Defaults to the target project's folder.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Where this configuration came from, for the UI:
    /// "user" (declared in .cln) or "inferred" (proposed by the IDE).
    #[serde(default = "default_config_origin")]
    pub origin: String,

    /// Named profiles. Empty when the method has no profile concept
    /// (npm, shell) or when the user hasn't declared any yet.
    #[serde(default)]
    pub profiles: Vec<Profile>,

    /// The default profile's name. Must match one of `profiles`, if any.
    #[serde(default)]
    pub default_profile: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSlots {
    pub build: Option<String>,
    pub run: Option<String>,
    pub debug: Option<String>,
}

fn default_config_kind() -> String { "run".into() }
fn default_config_target() -> String { ".".into() }
fn default_config_origin() -> String { "user".into() }


/// One named profile for a Configuration — a set of args and env vars
/// that varies the same build. Cargo's debug/release, dotnet's Debug/Release,
/// a user's "Server Local" / "Server Cloud" / "Deploy", all fit here.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub description: Option<String>,
}
