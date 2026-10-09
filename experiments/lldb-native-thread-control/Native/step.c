#include <pthread.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

int step_add_c(int left, int right) { // BREAK_C_LIBRARY
    int result = left + right;
    return result;
}

int step_pair_c(int left, int right);

static void *run_c_child(void *arg) {
    int encoded = *(int *)arg;
    step_pair_c(encoded, -1);
    return 0;
}

int step_pair_c(int left, int right) { // BREAK_C_PAIR_ENTRY
    if (right == -1) {
        int owner = left / 10, worker = left % 10;
        char path[100];
        snprintf(path, sizeof(path), "runs/native-c/owner-%d-worker-%d.txt", owner, worker);
        for (int beat = 1; beat <= 12; beat++) {
            FILE *file = fopen(path, "w"); // BREAK_C_PAIR_WORKER
            if (!file) return -1;
            fprintf(file, "%d", beat);
            fclose(file);
            usleep(20000);
        }
        return 0;
    }
    mkdir("runs", 0777);
    mkdir("runs/native-c", 0777);
    int owner = left / 1000;
    int one = owner * 10 + 1, two = owner * 10 + 2;
    pthread_t child;
    if (pthread_create(&child, 0, run_c_child, &two) != 0) return -1;
    step_pair_c(one, -1);
    pthread_join(child, 0);
    return left + right;
}
