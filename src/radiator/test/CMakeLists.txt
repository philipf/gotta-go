cmake_minimum_required(VERSION 3.20)
project(radiator_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ArduinoJson: reuse the exact copy the device build (arduino-cli) consumes —
# one source of truth, no second vendored tree. Override with -DARDUINOJSON_DIR
# if your Arduino libraries live elsewhere.
set(ARDUINOJSON_DIR "$ENV{HOME}/Arduino/libraries/ArduinoJson/src"
    CACHE PATH "Path to ArduinoJson headers")

if(NOT EXISTS "${ARDUINOJSON_DIR}/ArduinoJson.h")
    message(FATAL_ERROR
        "ArduinoJson.h not found under ${ARDUINOJSON_DIR}. Install it with "
        "`arduino-cli lib install ArduinoJson@7.4.3` (see ../README.md) or pass "
        "-DARDUINOJSON_DIR=/path/to/ArduinoJson/src.")
endif()

# Each module under test is compiled from its real firmware source; only the
# Arduino/EPD surface is swapped for host stubs/. net.cpp, sleep.cpp and
# battery.cpp are excluded — they are device-only (HTTPClient/TLS; the
# deep-sleep timer; the ADC read) with no host-testable seam. The sleep, etag
# and response-classifier policies are pure and header-only (sleep.h, etag.h,
# net.h), which the tests include directly.
add_executable(radiator_tests
    test_problem.cpp
    test_sleep.cpp
    test_frame.cpp
    test_etag.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../problem.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../frame.cpp
)

target_include_directories(radiator_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}          # doctest.h
    ${CMAKE_CURRENT_SOURCE_DIR}/stubs    # Arduino.h, epd_driver.h, firasans.h
    ${CMAKE_CURRENT_SOURCE_DIR}/..       # problem.h
    ${ARDUINOJSON_DIR}
)

target_compile_options(radiator_tests PRIVATE -Wall -Wextra)

enable_testing()
add_test(NAME radiator_tests COMMAND radiator_tests)
