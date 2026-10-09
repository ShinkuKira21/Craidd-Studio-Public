#include <chrono>
#include <thread>

static volatile int cpp_worker_beat[2];

extern "C" int step_add_cpp(int left, int right) { // BREAK_CPP_ENTRY
    auto worker = [](int number) {
        for (int beat = 1; beat <= 20; beat++) {
            cpp_worker_beat[number - 1] = beat; // BREAK_CPP_WORKER
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
        }
    };
    std::thread other(worker, 2);
    worker(1);
    other.join();
    return left + right;
}
