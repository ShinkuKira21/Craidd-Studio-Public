#include "scalar.h"

#include <algorithm>
#include <limits>

static std::int32_t bounded(std::int64_t value) {
    return static_cast<std::int32_t>(std::clamp(value,
        static_cast<std::int64_t>(std::numeric_limits<std::int32_t>::min()),
        static_cast<std::int64_t>(std::numeric_limits<std::int32_t>::max())));
}

extern "C" std::int32_t demo_add(std::int32_t left, std::int32_t right) {
    std::int64_t total = static_cast<std::int64_t>(left) + right; // NATIVE_ADD_ENTRY
    return bounded(total); // NATIVE_ADD_RETURN
}

extern "C" std::int32_t demo_accumulate(std::int32_t* values, std::size_t count,
                                        std::int32_t delta) {
    if (count > 1024 || (count != 0 && values == nullptr)) return -1; // NATIVE_BUFFER_ENTRY
    std::int64_t sum = 0;
    for (std::size_t index = 0; index < count; ++index) {
        values[index] = bounded(static_cast<std::int64_t>(values[index]) + delta);
        sum += values[index];
    }
    return bounded(sum);
}
