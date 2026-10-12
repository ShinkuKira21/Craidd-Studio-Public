#include <chrono>
#include <cstdio>
#include <sys/stat.h>
#include <thread>

static volatile int cpp_worker_beat[2];

extern "C" int step_add_cpp(int left, int right) { // BREAK_CPP_ENTRY
    mkdir("runs", 0777);
    mkdir("runs/native-cpp", 0777);
    auto worker = [](int number) {
        char path[100];
        std::snprintf(path, sizeof(path), "runs/native-cpp/worker-%d.txt", number);
        for (int beat = 1; beat <= 20; beat++) {
            cpp_worker_beat[number - 1] = beat; // BREAK_CPP_WORKER
            FILE *file = std::fopen(path, "w");
            if (!file) return;
            std::fprintf(file, "%d", beat);
            std::fclose(file);
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
        }
    };
    std::thread other(worker, 2);
    worker(1);
    other.join();
    return left + right;
}
