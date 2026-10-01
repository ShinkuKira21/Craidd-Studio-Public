cmake_minimum_required(VERSION 3.16)
project(LdiInteropPlayground LANGUAGES CXX)

add_library(demo_scalar SHARED scalar.cpp pointer.cpp)
add_library(demo_packet SHARED packet.cpp)
target_compile_features(demo_scalar PRIVATE cxx_std_17)
target_compile_features(demo_packet PRIVATE cxx_std_17)
target_compile_options(demo_scalar PRIVATE -O0 -g)
target_compile_options(demo_packet PRIVATE -O0 -g)

install(TARGETS demo_scalar demo_packet LIBRARY DESTINATION ".")
