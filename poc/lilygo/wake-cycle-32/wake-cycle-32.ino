/**
 * GottaGo — LilyGO T5 4.7": Wi-Fi + HTTPS GET + deep sleep wake cycle
 *
 * Spike #32. Proves the network + power half of a wake cycle end-to-end on the
 * LilyGO T5, with no panel involvement: connect to Wi-Fi, HTTPS GET a reachable
 * endpoint (poc/worker-helloworld or any HTTPS URL), log the response, then
 * esp_deep_sleep for a fixed duration. On wake the chip cold-boots and repeats,
 * incrementing a counter held in RTC memory so we can confirm the sleep is real
 * and the boot cycle is clean. See README.md.
 *
 * Deliberately isolates the Wi-Fi stack, TLS, and esp_deep_sleep from any
 * display concerns — no epd_driver, no framebuffer, so no PSRAM dependency.
 *
 * Board settings — identical to ../hello-world (see that sketch's header and its
 * sketch.yaml for the FQBN). USBMode=hwcdc + CDCOnBoot=cdc route Serial to the
 * native USB CDC on /dev/ttyACM0; note that the CDC link drops during deep sleep
 * and re-enumerates on wake (README covers how to watch all cycles).
 *
 * Wi-Fi credentials and the target URL live in secrets.h, which is gitignored.
 * Copy secrets.example.h to secrets.h and fill it in before flashing.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#include "secrets.h"  // WIFI_SSID, WIFI_PASSWORD, FRAME_URL

// Deep-sleep duration between wake cycles. 30 s keeps the spike observable; the
// real radiator takes this from the Worker's X-Sleep-Seconds (sleep duration).
static const uint64_t SLEEP_SECONDS = 30;

// Give up on the Wi-Fi association after this long and sleep anyway, so a flaky
// AP can never wedge the cycle.
static const uint32_t WIFI_TIMEOUT_MS = 15000;

// Wake counter. RTC_DATA_ATTR parks it in RTC slow memory, which survives deep
// sleep; only a true power-on / hard reset (not a timer wake) clears it back to
// zero. That zero-vs-nonzero distinction is how we tell a cold boot from a wake.
RTC_DATA_ATTR uint32_t wakeCount = 0;

static const char *wakeReasonStr(esp_sleep_wakeup_cause_t cause) {
    switch (cause) {
        case ESP_SLEEP_WAKEUP_TIMER: return "timer (deep-sleep wake)";
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "power-on / hard reset (cold boot)";
        default: return "other";
    }
}

// Connect to the hardcoded AP. Returns true once we have an IP, false on
// timeout. Logs SSID, outcome, IP, RSSI, and how long the association took.
static bool connectWiFi() {
    Serial.printf("Wi-Fi: connecting to \"%s\"\n", WIFI_SSID);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    const uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - t0) < WIFI_TIMEOUT_MS) {
        delay(100);
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("Wi-Fi: FAILED to connect within %lu ms\n",
                      (unsigned long)WIFI_TIMEOUT_MS);
        return false;
    }

    Serial.printf("Wi-Fi: connected in %lu ms — IP %s, RSSI %d dBm\n",
                  (unsigned long)(millis() - t0),
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
}

// HTTPS GET against FRAME_URL. Logs the status code, the Content-Length, and a
// hex dump of the first ~32 bytes of the body — the bytes preview matters
// because the real frame fetch returns a binary BMP, not text.
static void httpsGet() {
    WiFiClientSecure client;
    // Spike-only: skip server-cert validation. A production radiator pins or
    // bundles the CA for the Worker's host — out of scope for this slice.
    client.setInsecure();

    HTTPClient https;
    Serial.printf("HTTPS: GET %s\n", FRAME_URL);

    const uint32_t t0 = millis();
    if (!https.begin(client, FRAME_URL)) {
        Serial.println("HTTPS: begin() failed (bad URL?)");
        return;
    }

    const int status = https.GET();
    const uint32_t reqMs = millis() - t0;

    if (status <= 0) {
        Serial.printf("HTTPS: request failed: %s (%lu ms)\n",
                      HTTPClient::errorToString(status).c_str(),
                      (unsigned long)reqMs);
        https.end();
        return;
    }

    const int contentLength = https.getSize();  // Content-Length, or -1 if chunked
    Serial.printf("HTTPS: status %d, content-length %d (%lu ms)\n",
                  status, contentLength, (unsigned long)reqMs);

    // Pull the first 32 bytes off the stream rather than buffering the whole
    // body — same shape the real frame fetch will use for a large BMP.
    uint8_t buf[32];
    size_t n = 0;
    WiFiClient *stream = https.getStreamPtr();
    const uint32_t readStart = millis();
    while (n < sizeof(buf) && (millis() - readStart) < 5000) {
        while (stream->available() && n < sizeof(buf)) {
            buf[n++] = (uint8_t)stream->read();
        }
        if (n >= sizeof(buf) || !https.connected()) break;
        delay(1);
    }

    Serial.printf("HTTPS: first %u bytes:", (unsigned)n);
    for (size_t i = 0; i < n; i++) Serial.printf(" %02X", buf[i]);
    Serial.print("  |");
    for (size_t i = 0; i < n; i++) {
        Serial.write((buf[i] >= 0x20 && buf[i] < 0x7F) ? buf[i] : '.');
    }
    Serial.println("|");

    https.end();
}

static void sleepNow(uint32_t awakeMs) {
    // awakeMs is wake-to-sleep wall time: millis() resets to ~0 on each cold
    // boot out of deep sleep, so the value at this point is the active window we
    // spend draining the battery. This is the baseline for battery budgeting.
    // Repeat the wake count here as well as in the boot banner: this line
    // prints late (after the USB CDC has re-attached) and so survives the
    // re-enumeration race that can eat the banner. It's the reliable witness
    // that the RTC counter increments across sleeps.
    Serial.printf("Cycle #%lu: awake for %lu ms (wake-to-sleep) — sleeping %llu s\n",
                  (unsigned long)wakeCount, (unsigned long)awakeMs,
                  (unsigned long long)SLEEP_SECONDS);
    Serial.flush();  // drain the CDC FIFO before the USB peripheral powers down

    esp_sleep_enable_timer_wakeup(SLEEP_SECONDS * 1000000ULL);  // micros
    esp_deep_sleep_start();  // never returns; chip cold-boots into setup() on wake
}

void setup() {
    const uint32_t wakeStart = millis();

    Serial.begin(115200);
    delay(1000);  // let the host re-attach the CDC after the wake re-enumeration

    wakeCount++;
    Serial.println();
    Serial.printf("=== GottaGo wake cycle #%lu (#32) — wake reason: %s ===\n",
                  (unsigned long)wakeCount,
                  wakeReasonStr(esp_sleep_get_wakeup_cause()));

    if (connectWiFi()) {
        httpsGet();
    }
    WiFi.disconnect(true);  // drop the radio before sleeping

    sleepNow(millis() - wakeStart);
}

void loop() {
    // Unreachable: esp_deep_sleep_start() in setup() never returns.
}
