#pragma once
#include <cstddef>
#include <cstdint>
extern "C" int32_t gate_add(int32_t left, int32_t right);
extern "C" int gate_call_count();
extern "C" int32_t gate_measure(const char* label, const uint8_t* bytes, size_t count);
