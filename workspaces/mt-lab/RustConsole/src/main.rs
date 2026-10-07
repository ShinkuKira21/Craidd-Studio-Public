use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

fn main() {
    let variant = std::env::args().nth(1).unwrap_or_else(|| "basic".into());
    println!("Rust MT Console · {variant}");
    match variant.as_str() {
        "basic" => basic(),
        "burst" => burst(),
        "handoff" => handoff(),
        _ => panic!("Choose basic, burst, or handoff"),
    }
}

fn basic() {
    let start = Arc::new(Barrier::new(3));
    let workers: Vec<_> = (1..=2)
        .map(|number| {
            let start = Arc::clone(&start);
            thread::Builder::new()
                .name(format!("rs worker {number}"))
                .spawn(move || {
                    start.wait();
                    let marker = number * 10; // BREAK_RS_BASIC
                    for beat in 0..30 {
                        let sample = marker + beat;
                        if beat % 10 == 0 { println!("worker {number}: {sample}"); }
                        thread::sleep(Duration::from_millis(400));
                    }
                })
                .expect("spawn worker")
        })
        .collect();
    start.wait();
    for worker in workers { worker.join().expect("worker finished"); }
}

fn burst() {
    let mut workers = Vec::new();
    for number in 1..=10 {
        let worker = thread::Builder::new()
            .name(format!("rs short {number}"))
            .spawn(move || {
                let marker = number * 100; // BREAK_RS_BURST
                thread::sleep(Duration::from_millis(1500));
                println!("short worker {number}: {marker}");
            })
            .expect("spawn short worker");
        workers.push(worker);
        thread::sleep(Duration::from_millis(500));
    }
    for worker in workers { worker.join().expect("short worker finished"); }
}

fn handoff() {
    let (sender, receiver) = mpsc::channel::<i32>();
    let consumer = thread::Builder::new().name("rs consumer".into())
        .spawn(move || {
            for job in receiver {
                let result = job * 3; // BREAK_RS_HANDOFF
                println!("consumed {job}: {result}");
                thread::sleep(Duration::from_millis(350));
            }
        }).expect("spawn consumer");
    let producer = thread::Builder::new().name("rs producer".into())
        .spawn(move || {
            for job in 1..=12 {
                sender.send(job).expect("send job");
                thread::sleep(Duration::from_millis(250));
            }
        }).expect("spawn producer");
    producer.join().expect("producer finished");
    consumer.join().expect("consumer finished");
}
