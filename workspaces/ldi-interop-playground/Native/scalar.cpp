#include "scalar.h"

#include <cerrno>
#include <limits>
#include <stdexcept>

/* TEST 1 — do NOT add a red breakpoint for the first blue-only run.
   Expected: B pauses at the first executable line of this definition, not in
   scalar.h, a generated driver, or the managed process. */
extern "C" int demo_add(int left, int right) {
    int result = left + right;

    int z = 12; 
    int x = 2;
    return result; // RED_ADD — TEST 2: add red here; B should skip the automatic entry stop.
}

/* TEST 3 — no red: B pauses at entry and can step through the throw/catch.
   TEST 4 — red at RED_THROW or RED_CATCH: B lands at that explicit point. */
extern "C" int demo_divide(int numerator, int denominator) {
    try {
        if (denominator == 0) {
            throw std::domain_error("division by zero"); // RED_THROW: step into the C++ exception.
        }
        if (numerator == std::numeric_limits<int>::min() && denominator == -1) {
            throw std::overflow_error("division overflow");
        }
        errno = 0;
        int result = numerator / denominator; // RED_DIVIDE: ordinary successful path.
        return result;
    } catch (const std::domain_error&) {
        // An uncaught C++ exception must not cross this extern "C" / P-Invoke
        // boundary. Convert it into an observable native error instead.
        errno = EDOM;
        return std::numeric_limits<int>::min(); // RED_CATCH
    } catch (const std::overflow_error&) {
        errno = ERANGE;
        return std::numeric_limits<int>::min();
    }
}
