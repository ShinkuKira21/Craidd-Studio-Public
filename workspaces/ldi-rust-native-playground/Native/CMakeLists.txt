cmake_minimum_required(VERSION 3.16)
project(RustNativeScalar LANGUAGES CXX)

add_library(demo_scalar SHARED scalar.cpp)
target_compile_features(demo_scalar PRIVATE cxx_std_17)
target_compile_options(demo_scalar PRIVATE -Wall -Wextra -Wpedantic)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(demo_scalar PRIVATE $<$<CONFIG:Debug>:-O0;-g;-fno-omit-frame-pointer>)
endif()
