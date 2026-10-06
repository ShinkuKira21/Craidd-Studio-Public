#include <gtk/gtk.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#ifdef __linux__
#include <pthread.h>
#endif

using namespace std::chrono_literals;

static int run_number = 0; // UI thread only
static std::shared_ptr<std::atomic<bool>> basic_gate;

static void name_thread(const std::string& name) {
#ifdef __linux__
    pthread_setname_np(pthread_self(), name.substr(0, 15).c_str());
#else
    (void)name;
#endif
}

static GtkWidget* add_button(GtkWidget* box, const char* text, GCallback callback, GtkWidget* status) {
    GtkWidget* button = gtk_button_new_with_label(text);
    gtk_widget_set_hexpand(button, TRUE);
    g_signal_connect(button, "clicked", callback, status);
    gtk_box_append(GTK_BOX(box), button);
    return button;
}

static void activate(GtkApplication* app, gpointer) {
    GtkWidget* window = gtk_application_window_new(app);
    gtk_window_set_title(GTK_WINDOW(window), "C++ Multi-Thread Lab");
    gtk_window_set_default_size(GTK_WINDOW(window), 520, 360);
    GtkWidget* box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 10);
    gtk_widget_set_margin_top(box, 20);
    gtk_widget_set_margin_bottom(box, 20);
    gtk_widget_set_margin_start(box, 20);
    gtk_widget_set_margin_end(box, 20);
    gtk_window_set_child(GTK_WINDOW(window), box);

    GtkWidget* title = gtk_label_new("C++ Multi-Thread Lab");
    gtk_box_append(GTK_BOX(box), title);
    GtkWidget* status = gtk_label_new("Choose a variant. Workers report details to stdout.");
    gtk_label_set_wrap(GTK_LABEL(status), TRUE);

    add_button(box, "1 · Start two waiting workers", G_CALLBACK(+[](GtkButton*, gpointer data) {
        if (basic_gate) basic_gate->store(true);
        auto gate = std::make_shared<std::atomic<bool>>(false);
        basic_gate = gate;
        int run = ++run_number;
        for (int number = 1; number <= 2; ++number) {
            std::thread([gate, run, number] {
                name_thread("cpp gui " + std::to_string(number));
                while (!gate->load()) std::this_thread::sleep_for(20ms);
                int marker = run * 100 + number; // BREAK_CPP_GUI_BASIC
                for (int beat = 0; beat < 30; ++beat) {
                    int sample = marker + beat;
                    if (beat % 10 == 0) std::cout << "gui worker " << number << ": " << sample << std::endl;
                    std::this_thread::sleep_for(400ms);
                }
            }).detach();
        }
        gtk_label_set_text(GTK_LABEL(data), "Two named workers are waiting. Click Release workers.");
    }), status);

    add_button(box, "1 · Release workers", G_CALLBACK(+[](GtkButton*, gpointer data) {
        if (basic_gate) basic_gate->store(true);
        gtk_label_set_text(GTK_LABEL(data), "Workers released. Set a breakpoint at BREAK_CPP_GUI_BASIC.");
    }), status);

    add_button(box, "2 · Launch short worker burst", G_CALLBACK(+[](GtkButton*, gpointer data) {
        int run = ++run_number;
        for (int number = 1; number <= 6; ++number) {
            std::thread([run, number] {
                name_thread("cpp short " + std::to_string(number));
                int marker = run * 100 + number; // BREAK_CPP_GUI_BURST
                std::this_thread::sleep_for(std::chrono::milliseconds(700 + number * 250));
                std::cout << "short worker " << number << ": " << marker << std::endl;
            }).detach();
        }
        gtk_label_set_text(GTK_LABEL(data), "Six named short workers launched.");
    }), status);

    add_button(box, "3 · Producer / consumer handoff", G_CALLBACK(+[](GtkButton*, gpointer data) {
        struct QueueState {
            std::mutex mutex;
            std::condition_variable available;
            std::queue<int> jobs;
            bool done = false;
        };
        auto queue = std::make_shared<QueueState>();
        std::thread([queue] {
            name_thread("cpp producer");
            for (int job = 1; job <= 12; ++job) {
                {
                    std::lock_guard lock(queue->mutex);
                    queue->jobs.push(job);
                }
                queue->available.notify_one();
                std::this_thread::sleep_for(250ms);
            }
            {
                std::lock_guard lock(queue->mutex);
                queue->done = true;
            }
            queue->available.notify_one();
        }).detach();
        std::thread([queue] {
            name_thread("cpp consumer");
            for (;;) {
                int job;
                {
                    std::unique_lock lock(queue->mutex);
                    queue->available.wait(lock, [&] { return queue->done || !queue->jobs.empty(); });
                    if (queue->jobs.empty() && queue->done) break;
                    job = queue->jobs.front();
                    queue->jobs.pop();
                }
                int result = job * 3; // BREAK_CPP_GUI_HANDOFF
                std::cout << "consumed " << job << ": " << result << std::endl;
                std::this_thread::sleep_for(350ms);
            }
        }).detach();
        gtk_label_set_text(GTK_LABEL(data), "Producer and consumer launched. Inspect their wait and work frames.");
    }), status);

    gtk_box_append(GTK_BOX(box), status);
    gtk_window_present(GTK_WINDOW(window));
}

int main(int argc, char** argv) {
    GtkApplication* app = gtk_application_new("dev.craidd.mtcppgui", G_APPLICATION_DEFAULT_FLAGS);
    g_signal_connect(app, "activate", G_CALLBACK(activate), nullptr);
    int result = g_application_run(G_APPLICATION(app), argc, argv);
    g_object_unref(app);
    return result;
}
