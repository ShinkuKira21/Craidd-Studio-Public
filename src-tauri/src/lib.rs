mod commands;
mod types;

use commands::fs::{read_dir_tree, read_dir_tree_filtered, read_file, write_file, create_folder};
use commands::solution::{
    create_project_folder, find_ancestor_solution, load_solution, load_solution_named,
    save_project, save_solution, scan_craidd_files,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_dir_tree,
            read_dir_tree_filtered,
            write_file,
            create_folder,
            find_ancestor_solution,
            scan_craidd_files,
            load_solution,
            load_solution_named,
            save_project,
            save_solution,
            create_project_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
