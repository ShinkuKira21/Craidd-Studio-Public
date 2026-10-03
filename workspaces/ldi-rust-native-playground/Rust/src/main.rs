unsafe extern "C" {
    fn demo_add(left: i32, right: i32) -> i32;
    fn demo_accumulate(values: *mut i32, count: usize, delta: i32) -> i32;
}

#[inline(never)]
fn call_add(left: i32, right: i32) -> i32 {
    // A normal Rust breakpoint here demonstrates Step Into across the real FFI.
    // A native-only breakpoint skips this stop and lands directly inside C++.
    let result = unsafe { demo_add(left, right) }; // RUST_CALL_ADD
    result // RUST_AFTER_ADD
}

#[inline(never)]
fn mutate_buffer(values: &mut [i32], delta: i32) -> i32 {
    assert!(
        values.len() <= 1024,
        "Native ABI accepts at most 1024 values"
    );
    // SAFETY: the live mutable slice owns valid aligned storage for count items.
    // C++ borrows it synchronously and retains no pointers after returning.
    let sum = unsafe { demo_accumulate(values.as_mut_ptr(), values.len(), delta) }; // RUST_CALL_BUFFER
    sum // RUST_AFTER_BUFFER
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if !arguments.is_empty() && arguments.len() != 2 {
        eprintln!("Usage: rust-native-playground [left-i32 right-i32]");
        std::process::exit(64);
    }
    let parse = |index: usize, default: i32| -> i32 {
        arguments.get(index).map_or(default, |text| {
            text.parse().unwrap_or_else(|_| {
                eprintln!("Argument {} must be an Int32", index + 1);
                std::process::exit(64);
            })
        })
    };
    let left = parse(0, 20);
    let right = parse(1, 22);
    println!(
        "Rust process {}: the original FFI call, one LLDB session",
        std::process::id()
    );
    let result = call_add(left, right);
    println!("scalar: {left} + {right} = {result}");
    let mut values = [1, 2, 3];
    let sum = mutate_buffer(&mut values, 5);
    println!("borrowed buffer: {values:?}, sum = {sum}");
    assert_eq!(values, [6, 7, 8]);
    assert_eq!(sum, 21);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_call_returns_the_real_native_result() {
        assert_eq!(call_add(20, 22), 42);
        assert_eq!(call_add(-20, 22), 2);
    }

    #[test]
    fn native_mutates_the_callers_original_storage() {
        let mut values = [1, 2, 3];
        assert_eq!(mutate_buffer(&mut values, 5), 21);
        assert_eq!(values, [6, 7, 8]);
        assert_eq!(mutate_buffer(&mut [], 5), 0);
    }

    #[test]
    fn addition_saturates_instead_of_overflowing() {
        assert_eq!(call_add(i32::MAX, 1), i32::MAX);
        assert_eq!(call_add(i32::MIN, -1), i32::MIN);
    }
}
