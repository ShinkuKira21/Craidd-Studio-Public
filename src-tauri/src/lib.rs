mod commands;
mod types;

use commands::fs::{read_dir_tree, read_dir_children, read_dir_tree_filtered, read_file, write_file, create_folder, stat_files, overwrite_file, delete_path, rename_path};
use commands::search::search_in_path;
use commands::toolchain::{get_toolchain, scan_toolchain, ensure_project_toolchain, set_tool_default, preferences_file_path, read_project_tool_override, write_project_tool_override};
use commands::build::{BuildManager, start_cargo, stop_cargo, cancel_window_build};
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
use commands::window::{WindowRequests, get_startup_state, record_workspace_open, take_window_open_request, open_workspace_window, open_welcome_window, apply_window_geometry, capture_window_geometry};
use commands::runner::{RunnerManager, start_config, stop_config, cancel_window_run};
use commands::linked_windows::{LinkedWindowRegistry, update_linked_window, set_linked_window_visible, close_linked_window, view_linked_window, dispatch_linked_window_command, start_linked_action, acknowledge_linked_action, stop_linked_action, reveal_linked_problem, remove_linked_window, prepare_native_close};
use commands::breakpoints::{load_breakpoints, save_breakpoints};
use commands::debug::{DebugManager, start_rust_debug, update_debug_breakpoints, debug_control, cancel_window_debug};

#[tauri::command]
fn show_main_window(w: tauri::WebviewWindow) -> Result<(), String> {
    w.show().map_err(|e| e.to_string())?;

    // GNOME on Wayland: WebKitGTK sometimes registers the window's
    // drag/hit regions late, so min/max/close don't work until the
    // ribbon is double-clicked. Toggling resizable forces the
    // compositor to re-register the decoration regions.
    let _ = w.set_resizable(false);
    let _ = w.set_resizable(true);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BuildManager::default())
        .manage(WindowRequests::default())
        .manage(RunnerManager::default())
        .manage(DebugManager::default())
        .manage(LinkedWindowRegistry::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !prepare_native_close(window) {
                    api.prevent_close();
                    return;
                }
                capture_window_geometry(window);
                cancel_window_build(window);
                cancel_window_run(window);
                cancel_window_debug(window);
                remove_linked_window(window);
            }
        })
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
            ensure_project_toolchain,
            set_tool_default,
            preferences_file_path,
            read_project_tool_override,
            write_project_tool_override,
            start_cargo,
            stop_cargo,
            start_config,
            stop_config,
            infer_configs,
            get_startup_state,
            record_workspace_open,
            take_window_open_request,
            open_workspace_window,
            open_welcome_window,
            apply_window_geometry,
            update_linked_window,
            set_linked_window_visible,
            close_linked_window,
            view_linked_window,
            dispatch_linked_window_command,
            load_breakpoints,
            save_breakpoints,
            start_rust_debug,
            update_debug_breakpoints,
            debug_control,
            start_linked_action,
            acknowledge_linked_action,
            stop_linked_action,
            reveal_linked_problem,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
