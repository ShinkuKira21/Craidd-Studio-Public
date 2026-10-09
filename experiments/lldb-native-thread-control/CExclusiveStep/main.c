#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

struct worker {
    int number;
    const char *output;
    pthread_barrier_t *barrier;
};

static void write_count(const char *directory, int number, int value) {
    char path[512];
    snprintf(path, sizeof(path), "%s/worker-%d.txt", directory, number);
    FILE *file = fopen(path, "w");
    if (!file) { perror(path); exit(1); }
    fprintf(file, "%d", value);
    fclose(file);
}

static void *run_worker(void *argument) {
    struct worker *worker = argument;
    char name[16];
    snprintf(name, sizeof(name), "c step %d", worker->number);
#ifdef __linux__
    pthread_setname_np(pthread_self(), name);
#endif
    pthread_barrier_wait(worker->barrier);
    for (int beat = 1; beat <= 12; ++beat) {
        int marker = worker->number * 1000 + beat; // BREAK_NATIVE
        write_count(worker->output, worker->number, marker);
        struct timespec delay = { .tv_sec = 0, .tv_nsec = 50000000 };
        nanosleep(&delay, NULL);
    }
    return NULL;
}

int main(int argc, char **argv) {
    const char *output = argc > 1 ? argv[1] : "runs/c";
    char parent[512];
    snprintf(parent, sizeof(parent), "%s", output);
    char *separator = strrchr(parent, '/');
    if (separator) {
        *separator = '\0';
        if (mkdir(parent, 0777) != 0 && errno != EEXIST) { perror(parent); return 1; }
    }
    if (mkdir(output, 0777) != 0 && errno != EEXIST) { perror(output); return 1; }
    write_count(output, 1, 0);
    write_count(output, 2, 0);
    pthread_barrier_t barrier;
    pthread_barrier_init(&barrier, NULL, 2);
    pthread_t threads[2];
    struct worker workers[2];
    for (int index = 0; index < 2; ++index) {
        workers[index] = (struct worker){ .number = index + 1, .output = output, .barrier = &barrier };
        if (pthread_create(&threads[index], NULL, run_worker, &workers[index]) != 0) return 1;
    }
    for (int index = 0; index < 2; ++index) pthread_join(threads[index], NULL);
    pthread_barrier_destroy(&barrier);
    return 0;
}
