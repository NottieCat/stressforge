// Ready-to-run sample: the classic int-overflow stress test. The optimized
// solution uses a 32-bit accumulator and will mismatch the 64-bit brute force
// on large inputs — so a fresh visitor can hit "Run" and immediately see a
// counterexample being forged.

export const SAMPLE_GENERATOR = `#include <bits/stdc++.h>
using namespace std;

// argv[1] is the seed provided by StressForge (one per iteration).
int main(int argc, char** argv) {
    unsigned seed = argc > 1 ? (unsigned)strtoul(argv[1], nullptr, 10) : 0;
    mt19937 rng(seed);

    int n = 1 + rng() % 2000;          // array length
    printf("%d\\n", n);
    for (int i = 0; i < n; i++) {
        long long v = (long long)(rng() % 2000000001) - 1000000000;
        printf("%lld ", v);
    }
    printf("\\n");
    return 0;
}
`;

export const SAMPLE_BRUTE = `#include <bits/stdc++.h>
using namespace std;

// Trusted oracle: 64-bit accumulator, always correct.
int main() {
    int n;
    if (!(cin >> n)) return 0;
    long long sum = 0;
    for (int i = 0; i < n; i++) {
        long long x; cin >> x;
        sum += x;
    }
    cout << sum << "\\n";
    return 0;
}
`;

export const SAMPLE_OPTIMIZED = `#include <bits/stdc++.h>
using namespace std;

// BUG: 32-bit accumulator overflows once the true sum exceeds ~2.1e9.
// StressForge will find a seed where this disagrees with the brute force.
int main() {
    int n;
    if (!(cin >> n)) return 0;
    int sum = 0;                 // <-- should be long long
    for (int i = 0; i < n; i++) {
        int x; cin >> x;
        sum += x;
    }
    cout << sum << "\\n";
    return 0;
}
`;

/* ------------------------------------------------------------------ *
 * Submission mode: run the optimized solution on explicit inputs the
 * user pastes/uploads, optionally diffed against a reference oracle.
 * ------------------------------------------------------------------ */

export const SAMPLE_SUB_OPTIMIZED = `#include <bits/stdc++.h>
using namespace std;

// Reads: n, then n integers. Prints their sum.
// BUG: 32-bit accumulator overflows on large inputs (case #3 below).
int main() {
    int n;
    if (!(cin >> n)) return 0;
    int sum = 0;                 // <-- should be long long
    for (int i = 0; i < n; i++) {
        int x; cin >> x;
        sum += x;
    }
    cout << sum << "\\n";
    return 0;
}
`;

export const SAMPLE_SUB_REFERENCE = `#include <bits/stdc++.h>
using namespace std;

// Trusted oracle: 64-bit accumulator, always correct.
int main() {
    int n;
    if (!(cin >> n)) return 0;
    long long sum = 0;
    for (int i = 0; i < n; i++) {
        long long x; cin >> x;
        sum += x;
    }
    cout << sum << "\\n";
    return 0;
}
`;

// Explicit stdin cases, separated by a line containing only "---".
// The third case sums to 3e9, which overflows the 32-bit optimized solution.
export const SAMPLE_SUB_TESTS = `3
1 2 3
---
5
-1 -2 -3 -4 -5
---
3
2000000000 2000000000 -1000000000
`;
