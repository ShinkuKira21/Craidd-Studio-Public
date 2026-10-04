#pragma once

#include <cstddef>
#include <cstdint>

// Stable C ABI; addition saturates at the Int32 limits.
extern "C" std::int32_t demo_add(std::int32_t left, std::int32_t right);

// Borrowed storage in the caller's process. No allocation or ownership transfer.
// count must be <= 1024; a null pointer is accepted only when count is zero.
// Each update and the returned sum saturate at the Int32 limits.
extern "C" std::int32_t demo_accumulate(std::int32_t* values, std::size_t count,
                                        std::int32_t delta);
