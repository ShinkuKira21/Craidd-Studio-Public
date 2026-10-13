#include <chrono>
#include <cstdio>
#include <sys/stat.h>
#include <thread>

extern "C" int step_add_cpp(int left, int right) { // BREAK_CPP_LIBRARY
    int result = left + right;
    return result;
}

extern "C" int step_pair_cpp(int left, int right) { // BREAK_CPP_PAIR_ENTRY
    mkdir("runs", 0777);
    mkdir("runs/native-cpp", 0777);
    int owner = left / 1000;
    auto worker = [owner](int number) {
        char path[100];
        std::snprintf(path, sizeof(path), "runs/native-cpp/owner-%d-worker-%d.txt", owner, number);
        for (int beat = 1; beat <= 12; beat++) {
            FILE *file = std::fopen(path, "w"); // BREAK_CPP_PAIR_WORKER
            if (!file) return;
            std::fprintf(file, "%d", beat);
            std::fclose(file);
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
    };
    std::thread child(worker, 2);
    worker(1);
    child.join();
    return left + right;
}
