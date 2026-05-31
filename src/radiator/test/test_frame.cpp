// Host-native tests for the BMP validation path (frame module). The pixel-stamp
// writes go through the no-op epd_draw_pixel stub; what we assert here is the
// header contract: only a panel-sized (960x540) uncompressed 1bpp BMP decodes.
#include "doctest.h"

#include "frame.h"
#include "epd_driver.h"  // EPD_WIDTH / EPD_HEIGHT (host stub, on the include path)

#include <cstdint>
#include <cstring>
#include <vector>

// A minimal but valid 960x540 1bpp BMP: a 62-byte header (14 file + 40 info +
// the rest treated as padding to dataOffset) followed by zeroed pixel data. The
// decoder reads only the fields below; pixel content is irrelevant to validity.
static std::vector<uint8_t> validBmp() {
    const uint32_t dataOffset = 62;
    const int32_t  width = EPD_WIDTH, height = EPD_HEIGHT;
    const uint32_t rowStride = (((uint32_t)width * 1 + 31) / 32) * 4;  // 120
    std::vector<uint8_t> b(dataOffset + rowStride * height, 0);        // 64862
    auto putU16 = [&](uint32_t off, uint16_t v) {
        b[off] = v & 0xFF; b[off + 1] = (v >> 8) & 0xFF;
    };
    auto putU32 = [&](uint32_t off, uint32_t v) {
        b[off] = v & 0xFF; b[off + 1] = (v >> 8) & 0xFF;
        b[off + 2] = (v >> 16) & 0xFF; b[off + 3] = (v >> 24) & 0xFF;
    };
    b[0] = 'B'; b[1] = 'M';
    putU32(10, dataOffset);
    putU32(18, (uint32_t)width);
    putU32(22, (uint32_t)height);
    putU16(28, 1);   // bpp
    putU32(30, 0);   // compression
    return b;
}

static std::vector<uint8_t> framebuffer() {
    return std::vector<uint8_t>((size_t)EPD_WIDTH / 2 * EPD_HEIGHT, 0xFF);
}

TEST_CASE("decodeBmpToFramebuffer accepts a panel-sized 1bpp BMP") {
    auto bmp = validBmp();
    auto fb = framebuffer();
    CHECK(bmp.size() == EXPECTED_BMP_BYTES);
    CHECK(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
}

TEST_CASE("decodeBmpToFramebuffer accepts a top-down BMP (negative height)") {
    auto bmp = validBmp();
    auto fb = framebuffer();
    // negative height = top-down row order
    int32_t neg = -EPD_HEIGHT;
    std::memcpy(&bmp[22], &neg, 4);
    CHECK(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
}

TEST_CASE("decodeBmpToFramebuffer rejects bad magic and too-short input") {
    auto fb = framebuffer();
    auto bmp = validBmp();
    bmp[0] = 'X';
    CHECK_FALSE(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));

    uint8_t tiny[10] = {'B', 'M'};
    CHECK_FALSE(decodeBmpToFramebuffer(tiny, sizeof(tiny), fb.data()));
}

TEST_CASE("decodeBmpToFramebuffer rejects the wrong geometry / depth / compression") {
    auto fb = framebuffer();

    SUBCASE("wrong width") {
        auto bmp = validBmp();
        uint32_t w = 800; std::memcpy(&bmp[18], &w, 4);
        CHECK_FALSE(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
    }
    SUBCASE("not 1bpp") {
        auto bmp = validBmp();
        uint16_t bpp = 8; std::memcpy(&bmp[28], &bpp, 2);
        CHECK_FALSE(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
    }
    SUBCASE("compressed") {
        auto bmp = validBmp();
        uint32_t comp = 1; std::memcpy(&bmp[30], &comp, 4);
        CHECK_FALSE(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
    }
}

TEST_CASE("decodeBmpToFramebuffer rejects pixel data that runs past the buffer") {
    auto bmp = validBmp();
    auto fb = framebuffer();
    bmp.resize(bmp.size() - 100);  // truncate the pixel block
    CHECK_FALSE(decodeBmpToFramebuffer(bmp.data(), (uint32_t)bmp.size(), fb.data()));
}
