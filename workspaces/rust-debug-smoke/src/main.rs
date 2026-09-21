fn main() {
    let mut total = 0;

    for value in 1..=3 {
        total += value;
        println!("value={value}, total={total}");
    }

    assert_eq!(total, 6);
    println!("Debug session complete.");
}
