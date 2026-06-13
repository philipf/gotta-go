// Host-native stub of the LilyGo-EPD47 <epd_driver.h>. The panel can't exist
// off-device, so the draw calls are no-ops and text measurement returns a
// deterministic width — enough for problem.cpp to compile and link, and for the
// (static) word-wrap path to be exercised if a test ever drives it. The pure
// targets under test (parseProblem, resolveErrorScreen) don't touch any of this.
#pragma once

#include <cstdint>
#include <cstring>

#define EPD_WIDTH 960
#define EPD_HEIGHT 540

// Only the address of a GFXfont is taken; its layout is never inspected here.
typedef struct {
    uint8_t _unused;
} GFXfont;

inline void get_text_bounds(const GFXfont*, const char* str, int32_t* x, int32_t* y, int32_t* x1,
                            int32_t* y1, int32_t* w, int32_t* h, void*) {
    // ~12 px/char gives wrapText deterministic break points host-side.
    if (w)
        *w = static_cast<int32_t>(str ? std::strlen(str) * 12 : 0);
    if (h)
        *h = 40;
    (void)x;
    (void)y;
    (void)x1;
    (void)y1;
}

inline void write_string(const GFXfont*, const char*, int32_t*, int32_t*, void*) {}
inline void epd_poweron() {}
inline void epd_poweroff() {}
inline void epd_clear() {}
inline void epd_init() {}

// Framebuffer draw surface. The host stub records nothing — frame.cpp's tests
// assert on the decode/validate return value, not pixel output.
typedef struct {
    int32_t x, y, width, height;
} Rect_t;

inline Rect_t epd_full_screen() {
    return Rect_t{0, 0, EPD_WIDTH, EPD_HEIGHT};
}
inline void epd_draw_pixel(int32_t, int32_t, uint8_t, uint8_t*) {}
inline void epd_draw_grayscale_image(Rect_t, uint8_t*) {}
