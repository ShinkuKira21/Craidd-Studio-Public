cmake_minimum_required(VERSION 3.16)
project(OrderMath LANGUAGES CXX)
add_library(order_math SHARED math.cpp)
target_compile_features(order_math PRIVATE cxx_std_17)
# CMake, not Craidd, defines the artifact installation recipe.
# The Power Configuration supplies the selected .NET output as the prefix.
install(TARGETS order_math LIBRARY DESTINATION ".")
