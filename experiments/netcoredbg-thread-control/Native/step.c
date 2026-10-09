#include <pthread.h>
#include <unistd.h>

static volatile int c_worker_beat[2];
int step_add_c(int left, int right);
static void *c_worker(void *arg) {
    int number = *(int *)arg;
    step_add_c(number, -1);
    return 0;
}

int step_add_c(int left, int right) { // BREAK_C_ENTRY
    if (right == -1) {
        for (int beat = 1; beat <= 20; beat++) {
            c_worker_beat[left - 1] = beat; // BREAK_C_WORKER
            usleep(25000);
        }
        return 0;
    }
    pthread_t other;
    int one = 1, two = 2;
    if (pthread_create(&other, 0, c_worker, &two) != 0) return -1;
    step_add_c(one, -1);
    pthread_join(other, 0);
    return left + right;
}
