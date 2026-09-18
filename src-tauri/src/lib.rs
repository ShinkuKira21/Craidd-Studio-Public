mod commands;
mod types;

use commands::fs::{read_dir_tree, read_dir_children, read_dir_tree_filtered, read_file, write_file, create_folder, stat_files, overwrite_file, delete_path, rename_path};
use commands::search::search_in_path;
use commands::toolchain::{get_toolchain, scan_toolchain, set_tool_default, preferences_file_path, read_project_tool_override, write_project_tool_override};
use commands::build::{BuildManager, start_cargo, stop_cargo};
use commands::solution::{
    create_project_folder, find_ancestor_solution, load_solution, load_solution_named,
    save_project, save_solution, scan_craidd_files, remove_project, delete_project,
    edit_cln_repoint_entry,
    plan_craidd_filename,
    scan_craidd_in_folder_cmd,
    folder_language_claims_cmd,
    wipe_and_recreate_craidd,
    folder_is_empty,
    rescan_language_suggestion,
    set_solution_build_defaults,
};
use commands::manifests::read_manifests;
use commands::infer::infer_configs;
use commands::runner::{RunnerManager, start_config, stop_config};

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;

        // GNOME on Wayland: WebKitGTK sometimes registers the window's
        // drag/hit regions late, so min/max/close don't work until the
        // ribbon is double-clicked. Toggling resizable forces the
        // compositor to re-register the decoration regions.
        let _ = w.set_resizable(false);
        let _ = w.set_resizable(true);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BuildManager::default())
        .manage(RunnerManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_dir_tree,
            read_dir_children,
            read_dir_tree_filtered,
            write_file,
            create_folder,
            stat_files,
            overwrite_file,
            delete_path,
            rename_path,
            show_main_window,
            find_ancestor_solution,
            scan_craidd_files,
            load_solution,
            load_solution_named,
            save_project,
            save_solution,
            create_project_folder,
            remove_project,
            delete_project,
            edit_cln_repoint_entry,
            plan_craidd_filename,
            scan_craidd_in_folder_cmd,
            folder_language_claims_cmd,
            wipe_and_recreate_craidd,
            folder_is_empty,
            rescan_language_suggestion,
            set_solution_build_defaults,
            search_in_path,
            read_manifests,
            get_toolchain,
            scan_toolchain,
            set_tool_default,
            preferences_file_path,
            read_project_tool_override,
            write_project_tool_override,
            start_cargo,
            stop_cargo,
            start_config,
            stop_config,
            infer_configs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
