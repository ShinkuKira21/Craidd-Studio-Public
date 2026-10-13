#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#ifdef __linux__
#include <pthread.h>
#endif

int main() {
    std::mutex mutex;
    std::atomic<bool> owner_ready = false;
    std::atomic<bool> target_finished = false;
    std::thread owner([&] {
#ifdef __linux__
        pthread_setname_np(pthread_self(), "lock owner");
#endif
        mutex.lock();
        owner_ready = true;
        std::this_thread::sleep_for(std::chrono::milliseconds(800));
        mutex.unlock();
    });
    std::thread target([&] {
#ifdef __linux__
        pthread_setname_np(pthread_self(), "lock target");
#endif
        while (!owner_ready) std::this_thread::yield();
        mutex.lock(); // BREAK_WAIT
        target_finished = true;
        mutex.unlock();
    });
    owner.join();
    target.join();
    return target_finished ? 0 : 1;
}
