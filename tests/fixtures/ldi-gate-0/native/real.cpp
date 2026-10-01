#include "gate_api.h"
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <unistd.h>

static int calls = 0;
extern "C" int gate_call_count() { return calls; }

extern "C" int32_t gate_add(int32_t left, int32_t right) {
    ++calls; // NATIVE_STOP
    std::fprintf(stderr, "NATIVE pid=%d count=%d\n", static_cast<int>(getpid()), calls);
    std::fflush(stderr);
    int64_t sum = static_cast<int64_t>(left) + right; // NATIVE_STEP
    if (sum < std::numeric_limits<int32_t>::min() || sum > std::numeric_limits<int32_t>::max()) std::abort();
    errno = EDOM;
    return static_cast<int32_t>(sum);
}
