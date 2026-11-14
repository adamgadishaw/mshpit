# Retained text-layout geometry gate

Build with the installed React Native 0.86.3 Yoga sources and a C++20 compiler:

    cmake -S scripts/fixtures/show-text-yoga -B .tmp/show-text-yoga
    cmake --build .tmp/show-text-yoga

Set `PIT_TEXT_YOGA_PROBE` to the resulting executable, then run the native rating/layout tests. On Windows the installed MSVC/Ninja combination is supported. No package download or framework patch is used.

The caller serializes styles from rendered production components and explicit text-width/line-height metrics. The engine retains the same nodes through font-size and width changes, uses Fabric-style dirty commits, and returns every descendant's absolute bounds. Both settings of RN's optional fit-content flag are exercised.

This tests native flex geometry and complete-score containment. Text metrics are conservative, declared test inputs; it does not rasterize UIKit fonts or establish pixel, VoiceOver or hit-testing acceptance. Native Mac retesting of 375-point/3.571x, navigation and state remains required.
