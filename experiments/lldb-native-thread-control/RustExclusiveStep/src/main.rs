use std::path::PathBuf;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

fn main() {
    let output = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "runs/rust".into()));
    std::fs::create_dir_all(&output).expect("output directory");
    for number in 1..=2 {
        std::fs::write(output.join(format!("worker-{number}.txt")), "0").expect("initial counter");
    }
    let ready = Arc::new(Barrier::new(2));
    let mut workers = Vec::new();
    for number in 1..=2 {
        let ready = Arc::clone(&ready);
        let output = output.clone();
        workers.push(thread::Builder::new().name(format!("rust step {number}"))
            .spawn(move || {
                ready.wait();
                for beat in 1..=12 {
                    let marker = number * 1000 + beat; // BREAK_NATIVE
                    std::fs::write(output.join(format!("worker-{number}.txt")), marker.to_string()).expect("counter");
                    thread::sleep(Duration::from_millis(50));
                }
            }).expect("worker"));
    }
    for worker in workers { worker.join().expect("worker finished"); }
}
