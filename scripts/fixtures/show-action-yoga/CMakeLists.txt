cmake_minimum_required(VERSION 3.13)
project(show_action_yoga LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
# Compile the installed, lockfile-pinned React Native engine; no downloads or
# replacement Yoga package. Use a C++20 toolchain (MSVC, Clang or GCC).
set(YOGA_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../node_modules/react-native/ReactCommon/yoga")
file(GLOB YOGA_SOURCES "${YOGA_ROOT}/yoga/*.cpp" "${YOGA_ROOT}/yoga/*/*.cpp")
add_executable(show_action_yoga main.cpp ${YOGA_SOURCES})
target_include_directories(show_action_yoga PRIVATE "${YOGA_ROOT}")
