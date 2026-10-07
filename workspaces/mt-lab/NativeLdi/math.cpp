#include <atomic>
#include <chrono>
#include <pthread.h>
#include <string>
#include <thread>
#include <vector>

extern "C" int mt_add(int left, int right) {
    int result = left + right; // BREAK_CPP_LDI
    return result;
}

extern "C" int mt_add_workers(int left, int right) {
    std::atomic<int> ready{0};
    std::atomic<bool> start{false};
    std::atomic<int> total{0};
    std::vector<std::thread> workers;
    for (int number = 1; number <= 7; ++number) {
        workers.emplace_back([&, number] {
            const std::string name = "ldi worker " + std::to_string(number);
            pthread_setname_np(pthread_self(), name.c_str());
            ready.fetch_add(1);
            while (!start.load()) std::this_thread::yield();
            int contribution = left + right + number; // BREAK_CPP_LDI_WORKER
            total.fetch_add(contribution);
            std::this_thread::sleep_for(std::chrono::milliseconds(600));
        });
    }
    while (ready.load() < 7) std::this_thread::yield();
    start.store(true);
    for (auto& worker : workers) worker.join();
    return total.load();
}

extern "C" int mt_pair_workers(int left, int right) {
    std::atomic<int> ready{0};
    std::atomic<bool> start{false};
    std::atomic<int> total{0};
    std::vector<std::thread> workers;
    for (int number = 1; number <= 2; ++number) {
        workers.emplace_back([&, number] {
            const std::string name = "ldi pair " + std::to_string(number);
            pthread_setname_np(pthread_self(), name.c_str());
            ready.fetch_add(1);
            while (!start.load()) std::this_thread::yield();
            int contribution = left + right + number; // BREAK_CPP_LDI_PAIR
            total.fetch_add(contribution);
            std::this_thread::sleep_for(std::chrono::milliseconds(600));
        });
    }
    while (ready.load() < 2) std::this_thread::yield();
    start.store(true);
    for (auto& worker : workers) worker.join();
    return total.load();
}
