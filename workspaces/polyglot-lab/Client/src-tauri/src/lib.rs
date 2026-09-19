#[tauri::command]
fn backend_label() -> &'static str {
    "Rust command reached the Tauri backend."
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_label])
        .run(tauri::generate_context!())
        .expect("could not run polyglot lab client");
}

#[cfg(test)]
mod tests {
    #[test]
    fn backend_command_is_available() {
        assert_eq!(super::backend_label(), "Rust command reached the Tauri backend.");
    }
}
