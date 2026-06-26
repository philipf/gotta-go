/**
 * version.h — the firmware version string (GH #61).
 *
 * Surfaced on the error screen's diagnostics footer and in the wake banner so a
 * radiator in the field can be matched to a build. Bumped by hand on release.
 *
 * This is a build-level constant, not a per-deployment one, so it lives here
 * (tracked) rather than in the gitignored settings.h — every radiator on the
 * same firmware reports the same version regardless of its settings variant.
 */
#pragma once

#define FIRMWARE_VERSION "0.1.0"
