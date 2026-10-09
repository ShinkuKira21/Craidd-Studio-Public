use std::{fs, path::PathBuf, sync::{Arc, Barrier}, thread, time::Duration};

unsafe extern "C" {
    #[cfg(not(feature = "cpp"))]
    fn step_add_c(left: i32, right: i32) -> i32;
    #[cfg(feature = "cpp")]
    fn step_add_cpp(left: i32, right: i32) -> i32;
}

#[cfg(not(feature = "cpp"))]
fn native_add(left: i32, right: i32) -> i32 {
    unsafe { step_add_c(left, right) } // BLUE_RUST_C
}

#[cfg(feature = "cpp")]
fn native_add(left: i32, right: i32) -> i32 {
    unsafe { step_add_cpp(left, right) } // BLUE_RUST_CPP
}

fn main() {
    let output = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "runs/linked".into()));
    fs::create_dir_all(&output).unwrap();
    for number in 1..=2 {
        fs::write(output.join(format!("worker-{number}.txt")), "0").unwrap();
    }
    let gate = Arc::new(Barrier::new(2));
    let workers: Vec<_> = (1..=2).map(|number| {
        let output = output.clone();
        let gate = Arc::clone(&gate);
        thread::Builder::new().name(format!("rust linked {number}")).spawn(move || {
            gate.wait();
            for beat in 1..=60 {
                let marker = number * 1000 + beat; // BREAK_RUST
                let value = native_add(marker, 0);
                fs::write(output.join(format!("worker-{number}.txt")), value.to_string()).unwrap();
                thread::sleep(Duration::from_millis(50));
            }
        }).unwrap()
    }).collect();
    for worker in workers { worker.join().unwrap(); }
}
