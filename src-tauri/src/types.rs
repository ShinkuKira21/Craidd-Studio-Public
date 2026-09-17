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
