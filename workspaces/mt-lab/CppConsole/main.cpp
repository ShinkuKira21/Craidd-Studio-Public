#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#ifdef __linux__
#include <pthread.h>
#endif

using namespace std::chrono_literals;

static void name_thread(const std::string& name) {
#ifdef __linux__
    pthread_setname_np(pthread_self(), name.substr(0, 15).c_str());
#else
    (void)name;
#endif
}

static void basic() {
    std::mutex mutex;
    std::condition_variable start;
    bool ready = false;
    std::vector<std::thread> workers;
    for (int number = 1; number <= 2; ++number) {
        workers.emplace_back([&, number] {
            name_thread("cpp worker " + std::to_string(number));
            {
                std::unique_lock lock(mutex);
                start.wait(lock, [&] { return ready; });
            }
            int marker = number * 10; // BREAK_CPP_BASIC
            for (int beat = 0; beat < 30; ++beat) {
                int sample = marker + beat;
                if (beat % 10 == 0) std::cout << "worker " << number << ": " << sample << '\n';
                std::this_thread::sleep_for(400ms);
            }
        });
    }
    {
        std::lock_guard lock(mutex);
        ready = true;
    }
    start.notify_all();
    for (auto& worker : workers) worker.join();
}

static void burst() {
    std::vector<std::thread> workers;
    for (int number = 1; number <= 10; ++number) {
        workers.emplace_back([number] {
            name_thread("cpp short " + std::to_string(number));
            int marker = number * 100; // BREAK_CPP_BURST
            std::this_thread::sleep_for(1500ms);
            std::cout << "short worker " << number << ": " << marker << '\n';
        });
        std::this_thread::sleep_for(500ms);
    }
    for (auto& worker : workers) worker.join();
}

static void handoff() {
    std::mutex mutex;
    std::condition_variable available;
    std::queue<int> jobs;
    bool done = false;
    std::thread consumer([&] {
        name_thread("cpp consumer");
        for (;;) {
            int job;
            {
                std::unique_lock lock(mutex);
                available.wait(lock, [&] { return done || !jobs.empty(); });
                if (jobs.empty() && done) break;
                job = jobs.front();
                jobs.pop();
            }
            int result = job * 3; // BREAK_CPP_HANDOFF
            std::cout << "consumed " << job << ": " << result << '\n';
            std::this_thread::sleep_for(350ms);
        }
    });
    std::thread producer([&] {
        name_thread("cpp producer");
        for (int job = 1; job <= 12; ++job) {
            {
                std::lock_guard lock(mutex);
                jobs.push(job);
            }
            available.notify_one();
            std::this_thread::sleep_for(250ms);
        }
        {
            std::lock_guard lock(mutex);
            done = true;
        }
        available.notify_one();
    });
    producer.join();
    consumer.join();
}

int main(int argc, char** argv) {
    const std::string variant = argc > 1 ? argv[1] : "basic";
    std::cout << "C++ MT Console · " << variant << '\n';
    if (variant == "basic") basic();
    else if (variant == "burst") burst();
    else if (variant == "handoff") handoff();
    else throw std::invalid_argument("Choose basic, burst, or handoff");
}
