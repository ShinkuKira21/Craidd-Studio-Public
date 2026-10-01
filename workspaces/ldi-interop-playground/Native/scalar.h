#pragma once

// Exported C ABI. Exceptions are caught before they can cross into .NET.
extern "C" int demo_add(int left, int right);
extern "C" int demo_divide(int numerator, int denominator);
