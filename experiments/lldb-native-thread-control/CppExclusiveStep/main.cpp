#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#ifdef __linux__
#include <pthread.h>
#endif

int main(int argc, char** argv) {
    const std::filesystem::path output = argc > 1 ? argv[1] : "runs/cpp";
    std::filesystem::create_directories(output);
    for (int number = 1; number <= 2; ++number)
        std::ofstream(output / ("worker-" + std::to_string(number) + ".txt")) << 0;

    std::mutex mutex;
    std::condition_variable ready;
    int arrived = 0;
    std::vector<std::thread> workers;
    for (int number = 1; number <= 2; ++number) {
        workers.emplace_back([&, number] {
#ifdef __linux__
            const std::string name = "cpp step " + std::to_string(number);
            pthread_setname_np(pthread_self(), name.c_str());
#endif
            {
                std::unique_lock lock(mutex);
                ++arrived;
                ready.notify_all();
                ready.wait(lock, [&] { return arrived == 2; });
            }
            for (int beat = 1; beat <= 12; ++beat) {
                const int marker = number * 1000 + beat; // BREAK_NATIVE
                std::ofstream(output / ("worker-" + std::to_string(number) + ".txt")) << marker;
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
        });
    }
    for (auto& worker : workers) worker.join();
}
