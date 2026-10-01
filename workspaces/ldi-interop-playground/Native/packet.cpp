#include "packet.h"

#include <cstring>

/* TEST 5 — no red: B pauses at this export's first executable line.
   TEST 6 — red at RED_PACKET: B lands there instead. With Café / 0,3,7,
   inspect label as UTF-8 and bytes as an independent B-owned allocation. */
extern "C" int demo_score(const char* label, const uint8_t* bytes, size_t count) {
    /* TEST 7 — a 4097-byte label is valid to this real export, but the LDI
       proxy must reject its bounded reproduction before B gets here. */
    if (!label || (count != 0 && !bytes)) return -1;
    // strlen counts UTF-8 bytes, not C# characters. Zero bytes in the payload
    // are valid data because that buffer has its own explicit length.
    int score = static_cast<int>(std::strlen(label)); // RED_PACKET: typed LDI can stop here.
    for (size_t index = 0; index < count; ++index)
        score = (score + static_cast<int>(bytes[index]) * static_cast<int>((index % 31) + 1)) % 1000000;
    return score;
}
