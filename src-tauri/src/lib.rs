mod commands;
mod types;
mod process_supervisor;

pub use process_supervisor::entry as process_supervisor_entry;

use tauri::Manager;

use commands::fs::{read_dir_tree, read_dir_children, read_dir_tree_filtered, read_file, write_file, create_folder, stat_files, overwrite_file, delete_path, rename_path};
use commands::search::search_in_path;
use commands::toolchain::{get_toolchain, scan_toolchain, ensure_project_toolchain, set_tool_default, preferences_file_path, read_project_tool_override, write_project_tool_override};
use commands::build::{BuildManager, start_cargo, stop_cargo};
use commands::solution::{
    create_project_folder, find_ancestor_solution, load_solution, load_solution_named,
    save_project, save_solution, save_solution_configs, scan_craidd_files, remove_project, delete_project,
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
use commands::window::{WindowRequests, get_startup_state, is_chromeos_guest, record_workspace_open, take_window_open_request, open_workspace_window, open_welcome_window, apply_window_geometry, capture_window_geometry};
use commands::runner::{RunnerManager, start_config, stop_config};
use commands::linked_windows::{LinkedWindowRegistry, update_linked_window, set_linked_window_visible, update_parked_window_configuration, close_linked_window, get_application_windows, exit_application, stop_solution_sessions, view_linked_window, focus_linked_window, dispatch_linked_window_command, start_linked_action, acknowledge_linked_action, stop_linked_action, stop_linked_member, reveal_linked_problem, remove_linked_window, prepare_native_close, note_window_shown, get_linked_runtime, mark_linked_window_ready, abort_parked_restore, clear_native_close_guard, reset_linked_action, preview_linked_action, probe_linked_readiness};
use commands::breakpoints::{load_breakpoints, save_breakpoints};
use commands::linked_windows::restart_linked_sessions;
use commands::debug::{DebugBuildManager, DebugManager, start_debug, debug_control, debug_select_thread, debug_refresh_threads};

#[tauri::command]
fn show_main_window(w: tauri::WebviewWindow, requests: tauri::State<'_, WindowRequests>) -> Result<(), String> {
    if requests.1.lock().map_err(|e| e.to_string())?.contains(w.label()) { return Ok(()); }
    if w.is_visible().map_err(|e| e.to_string())? { return Ok(()); }
    w.show().map_err(|e| e.to_string())?;
    note_window_shown(&w.app_handle(), w.label());

    // Some Wayland compositors register native decoration hit regions late.
    // ChromeOS reports X-Generic, while desktop GNOME reports GNOME.
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_lowercase();
    if (desktop.contains("gnome") || desktop.contains("x-generic"))
        && std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland") {
        let _ = w.set_resizable(false);
        let _ = w.set_resizable(true);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    process_supervisor::initialize(&std::env::current_exe().expect("could not find IDE executable"))
        .expect("could not initialize IDE process cleanup supervisor");
    tauri::Builder::default()
        .manage(BuildManager::default())
        .manage(WindowRequests::default())
        .manage(RunnerManager::default())
        .manage(commands::tauri_dev::TauriDevServers::default())
        .manage(DebugManager::default())
        .manage(DebugBuildManager::default())
        .manage(commands::ldi::LdiManager::default())
        .manage(commands::native_debug::NativeDebugManager::default())
        .manage(commands::build_order::OrderManager::default())
        .manage(LinkedWindowRegistry::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !prepare_native_close(window) {
                    api.prevent_close();
                    return;
                }
                capture_window_geometry(window);
                let closing_window = window.clone();
                // Never wait for LDI/DAP teardown from the native event loop.
                std::thread::spawn(move || {
                    commands::build::cancel_window_build(&closing_window);
                    commands::runner::cancel_window_run(&closing_window);
                    commands::debug::cancel_window_debug(&closing_window);
                });
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
            commands::window::abort_initial_hidden_window,
            commands::ldi::set_ldi_blue,
            commands::ldi::list_ldi_call_sites,
            commands::ldi::remove_ldi_blue,
            commands::ldi::reconcile_ldi_blues_on_save,
            commands::ldi::get_ldi_blues,
            commands::ldi::abandon_ldi_reproduction,
            commands::native_debug::get_native_debug_context,
            commands::native_debug::native_debug_control,
            get_linked_runtime,
            mark_linked_window_ready,
            abort_parked_restore,
            update_parked_window_configuration,
            find_ancestor_solution,
            scan_craidd_files,
            load_solution,
            load_solution_named,
            save_project,
            save_solution,
            save_solution_configs,
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
            commands::toolchain::set_debug_symbol_downloads,
            preferences_file_path,
            read_project_tool_override,
            write_project_tool_override,
            start_cargo,
            stop_cargo,
            start_config,
            stop_config,
            infer_configs,
            get_startup_state,
            is_chromeos_guest,
            record_workspace_open,
            take_window_open_request,
            open_workspace_window,
            open_welcome_window,
            apply_window_geometry,
            update_linked_window,
            set_linked_window_visible,
            close_linked_window,
            get_application_windows,
            exit_application,
            stop_solution_sessions,
            view_linked_window,
            focus_linked_window,
            dispatch_linked_window_command,
            load_breakpoints,
            save_breakpoints,
            start_debug,
            commands::tauri_dev::describe_debug_prerequisites,
            debug_control,
            debug_select_thread,
            debug_refresh_threads,
            start_linked_action,
            preview_linked_action,
            probe_linked_readiness,
            acknowledge_linked_action,
            stop_linked_action,
            stop_linked_member,
            restart_linked_sessions,
            reveal_linked_problem,
            clear_native_close_guard,
            reset_linked_action,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) { process_supervisor::shutdown(); }
        });
    process_supervisor::shutdown();
}
