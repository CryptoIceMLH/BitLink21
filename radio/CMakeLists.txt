cmake_minimum_required(VERSION 3.10)
project(bitlink21-radio CXX)

# C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find dependencies
# liquid-dsp and libiio don't provide CMake configs, use pkg-config instead
find_package(PkgConfig REQUIRED)
find_package(OpenSSL REQUIRED)
pkg_check_modules(liquid REQUIRED liquid)
pkg_check_modules(IIO REQUIRED libiio)

find_package(Threads REQUIRED)

# Add library directories from pkg-config
link_directories(${liquid_LIBRARY_DIRS} ${IIO_LIBRARY_DIRS})

# ============================================================================
# Logger Library
# ============================================================================

add_library(logger STATIC
    src/logger.cpp
)
target_include_directories(logger PUBLIC src/)
target_link_libraries(logger PRIVATE Threads::Threads)

# ============================================================================
# Phase 3b: Beacon Lock + DSP Common Library
# ============================================================================

# Beacon Lock PLL library
add_library(beacon_lock STATIC
    src/beacon_lock.cpp
)
target_include_directories(beacon_lock PUBLIC src/)
target_include_directories(beacon_lock PUBLIC ${liquid_INCLUDE_DIRS})
target_link_libraries(beacon_lock
    PUBLIC ${liquid_LIBRARIES}
    PRIVATE Threads::Threads
)

# DSP Common Library (Phase 4a)
add_library(dsp_common STATIC
    src/dsp_common.cpp
)
target_include_directories(dsp_common PUBLIC src/)
target_include_directories(dsp_common PUBLIC ${liquid_INCLUDE_DIRS})
target_link_libraries(dsp_common
    PUBLIC ${liquid_LIBRARIES}
    PRIVATE Threads::Threads
)

# ============================================================================
# SSP Protocol Library (FEC framing + codec)
# ============================================================================

add_library(ssp STATIC
    src/ssp.cpp
)
target_include_directories(ssp PUBLIC src/)
target_include_directories(ssp PUBLIC ${liquid_INCLUDE_DIRS})
target_link_libraries(ssp PUBLIC ${liquid_LIBRARIES})

# ============================================================================
# Hardware Abstraction Layer (Phase 4c)
# ============================================================================

add_library(hw_plutosdr STATIC
    src/hw_plutosdr.cpp
)
target_include_directories(hw_plutosdr PUBLIC src/)
target_include_directories(hw_plutosdr PUBLIC ${IIO_INCLUDE_DIRS})
target_link_libraries(hw_plutosdr
    PUBLIC
        ${IIO_LIBRARIES}
    PRIVATE
        ad9361
        Threads::Threads
)

# ============================================================================
# Core Transceiver Library (Phase 3b+)
# Will consolidate when all DSP modules are complete
# ============================================================================

add_library(bitlink21-transceiver STATIC
    # Phase 3b: beacon lock (✅ DONE)
    # Phase 4a: DSP common utilities (✅ DONE)
    # Phase 4b: PSK demodulator/modulator (✅ DONE)
    # Phase 4c: hardware abstraction layer (✅ DONE)
    # Phase 7: WebSocket telemetry server (✅ DONE)
    # Phase 8: CSMA channel access (✅ DONE)
    src/rx_dsp_psk.cpp
    src/tx_dsp_psk.cpp
    src/ws_server.cpp
    src/csma.cpp
    src/radio_controller.cpp
)
target_include_directories(bitlink21-transceiver PUBLIC src/)
target_include_directories(bitlink21-transceiver PUBLIC ${liquid_INCLUDE_DIRS} ${IIO_INCLUDE_DIRS} ${OPENSSL_INCLUDE_DIR})
target_link_libraries(bitlink21-transceiver
    PUBLIC
        ${liquid_LIBRARIES}
        beacon_lock
        dsp_common
        ssp
        hw_plutosdr
        logger
    PRIVATE
        ${IIO_LIBRARIES}
        OpenSSL::Crypto
        Threads::Threads
)

# ============================================================================
# Main Radio Binary (Phase 9: Final Integration)
# ============================================================================

add_executable(bitlink21-radio src/main.cpp)
target_include_directories(bitlink21-radio PRIVATE src/)
target_link_libraries(bitlink21-radio
    PRIVATE
        bitlink21-transceiver
        beacon_lock
        dsp_common
        ssp
        hw_plutosdr
        logger
        ${liquid_LIBRARIES}
        ${IIO_LIBRARIES}
        ad9361
        OpenSSL::Crypto
        Threads::Threads
)

# ============================================================================
# Test Suite (Phase 4)
# ============================================================================

# Uncomment when test infrastructure is in place
# enable_testing()
# add_subdirectory(tests)
