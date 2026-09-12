use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CraiddProject {
    pub id: String,
    pub name: String,
    pub language: String,
    pub root: String,
    pub path: String,
    pub folder: String,
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
    pub kind: String,       // "file" | "folder"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}
