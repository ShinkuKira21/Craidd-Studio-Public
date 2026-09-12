mod commands;
mod types;

use commands::fs::{read_dir_tree, read_dir_tree_filtered, read_file};
use commands::solution::{load_solution, save_project, save_solution};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_dir_tree,
            read_dir_tree_filtered,
            load_solution,
            save_project,
            save_solution,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
