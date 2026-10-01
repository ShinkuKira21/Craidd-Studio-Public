#include "gate_api.h"
#include <cstdio>
#include <cstdlib>
#include <unistd.h>

extern "C" int32_t gate_measure(const char* label, const uint8_t* bytes, size_t count) {
    if (!label || (!bytes && count)) std::abort();
    std::fprintf(stderr, "NATIVE_MEASURE pid=%d\n", static_cast<int>(getpid())); // NATIVE_MEASURE_STOP
    int32_t total = 0;
    for (const unsigned char* p = reinterpret_cast<const unsigned char*>(label); *p; ++p) total += *p;
    for (size_t i = 0; i < count; ++i) total += bytes[i];
    return total;
}
