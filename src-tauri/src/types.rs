use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CraiddProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub language: Option<String>,
    pub root: String,
    pub path: String,
    pub folder: String,

    #[serde(rename = "configEnabled", default)]
    pub config_enabled: bool,
    #[serde(rename = "configName", default)]
    pub config_name: Option<String>,
    #[serde(rename = "configDirectory", default)]
    pub config_directory: Option<String>,
    #[serde(rename = "configInclude", default)]
    pub config_include: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CraiddSolution {
    pub name: String,
    pub root: String,
    pub projects: Vec<CraiddProject>,
    #[serde(rename = "runDefault")]
    pub run_default: Option<String>,
    #[serde(rename = "debugDefault")]
    pub debug_default: Option<String>,
    #[serde(default)]
    pub autostart: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}
