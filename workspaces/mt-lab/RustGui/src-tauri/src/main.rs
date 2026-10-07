use std::sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct BasicGate(Mutex<Option<Arc<AtomicBool>>>);
static NEXT_RUN: AtomicUsize = AtomicUsize::new(1);

#[tauri::command]
fn start_variant(app: AppHandle, gate: State<'_, BasicGate>, variant: u8) -> Result<String, String> {
    let run = NEXT_RUN.fetch_add(1, Ordering::Relaxed);
    match variant {
        1 => {
            let mut slot = gate.0.lock().map_err(|error| error.to_string())?;
            if let Some(previous) = slot.take() { previous.store(true, Ordering::Release); }
            let release = Arc::new(AtomicBool::new(false));
            *slot = Some(Arc::clone(&release));
            for number in 1..=2 {
                let release = Arc::clone(&release);
                let app = app.clone();
                thread::Builder::new().name(format!("rs gui {run}-{number}"))
                    .spawn(move || {
                        while !release.load(Ordering::Acquire) { thread::sleep(Duration::from_millis(20)); }
                        let marker = run * 100 + number; // BREAK_RS_GUI_BASIC
                        for beat in 0..30 {
                            let sample = marker + beat;
                            if beat % 10 == 0 { let _ = app.emit("mt-status", format!("Worker {number} sampled {sample}")); }
                            thread::sleep(Duration::from_millis(400));
                        }
                    }).map_err(|error| error.to_string())?;
            }
            Ok(format!("Run {run}: two workers waiting. Click Release workers."))
        }
        2 => {
            for number in 1..=6 {
                let app = app.clone();
                thread::Builder::new().name(format!("rs short {run}-{number}"))
                    .spawn(move || {
                        let marker = run * 100 + number; // BREAK_RS_GUI_BURST
                        thread::sleep(Duration::from_millis(700 + number as u64 * 250));
                        let _ = app.emit("mt-status", format!("Short worker {number} completed: {marker}"));
                    }).map_err(|error| error.to_string())?;
            }
            Ok(format!("Run {run}: six short workers launched."))
        }
        3 => {
            let (sender, receiver) = mpsc::channel::<usize>();
            let consumer_app = app.clone();
            thread::Builder::new().name(format!("rs consumer {run}"))
                .spawn(move || {
                    for job in receiver {
                        let result = job * 3; // BREAK_RS_GUI_HANDOFF
                        let _ = consumer_app.emit("mt-status", format!("Consumed {job}: {result}"));
                        thread::sleep(Duration::from_millis(350));
                    }
                }).map_err(|error| error.to_string())?;
            thread::Builder::new().name(format!("rs producer {run}"))
                .spawn(move || {
                    for job in 1..=12 {
                        if sender.send(job).is_err() { break; }
                        thread::sleep(Duration::from_millis(250));
                    }
                }).map_err(|error| error.to_string())?;
            Ok(format!("Run {run}: producer and consumer launched."))
        }
        _ => Err("Choose variant 1, 2, or 3".into()),
    }
}

#[tauri::command]
fn release_basic(gate: State<'_, BasicGate>) -> Result<String, String> {
    let slot = gate.0.lock().map_err(|error| error.to_string())?;
    if let Some(release) = slot.as_ref() {
        release.store(true, Ordering::Release);
        Ok("Waiting workers released.".into())
    } else { Ok("Start variant 1 first.".into()) }
}

fn main() {
    tauri::Builder::default()
        .manage(BasicGate::default())
        .invoke_handler(tauri::generate_handler![start_variant, release_basic])
        .run(tauri::generate_context!())
        .expect("could not start Rust MT GUI");
}
