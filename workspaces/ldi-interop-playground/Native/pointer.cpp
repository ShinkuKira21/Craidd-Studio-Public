#include "pointer.h"

#include <new>

/* TEST 8 — no LDI pairing for this pointer signature. This function only
   receives a valid address when called by A's ordinary managed process. */
extern "C" int demo_bump(int32_t* value) {
    if (!value) return -1;
    ++*value; // This address belongs to A; a separate B process cannot reuse it.
    return *value;
}

/* TEST 9 — the returned handle is owned by A's native process. C# must call
   demo_free_counter after reading it; B cannot borrow this address. */
extern "C" void* demo_new_counter(int initial) {
    return new (std::nothrow) int(initial);
}

extern "C" int demo_read_counter(const void* handle) {
    return handle ? *static_cast<const int*>(handle) : -1;
}

extern "C" void demo_free_counter(void* handle) {
    delete static_cast<int*>(handle);
}
