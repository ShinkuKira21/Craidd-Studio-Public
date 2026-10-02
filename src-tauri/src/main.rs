// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if craidd_studio_lib::process_supervisor_entry() { return; }
    craidd_studio_lib::run()
}
