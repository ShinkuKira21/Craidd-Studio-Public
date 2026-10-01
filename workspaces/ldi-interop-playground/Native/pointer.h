#pragma once

#include <cstdint>

extern "C" int demo_bump(int32_t* value);
extern "C" void* demo_new_counter(int initial);
extern "C" int demo_read_counter(const void* handle);
extern "C" void demo_free_counter(void* handle);
