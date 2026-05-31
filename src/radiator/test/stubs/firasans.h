// Host-native stub of the bundled <firasans.h> font. problem.cpp only takes the
// address of FiraSans; a single inline definition satisfies the link off-device.
#pragma once

#include "epd_driver.h"

inline const GFXfont FiraSans{};
