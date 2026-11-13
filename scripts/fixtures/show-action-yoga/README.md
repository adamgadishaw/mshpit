# Mounted Show action geometry

This optional native-engine gate complements the ordinary JS component tests.
It compiles the installed React Native Yoga C++ sources without changing them,
feeds styles captured from the real mounted Show, and retains the same Yoga
nodes through growth, shrinkage and rotation. It follows Fabric's style update
path, which differs from Yoga's public C setters in flex-basis invalidation.

With a local C++20 compiler and CMake (no downloads):

```sh
cmake -S scripts/fixtures/show-action-yoga -B .tmp/show-action-yoga -DCMAKE_BUILD_TYPE=Release
cmake --build .tmp/show-action-yoga --config Release --parallel 2
PIT_YOGA_LAYOUT_PROBE="$PWD/.tmp/show-action-yoga/show_action_yoga" node --test --test-name-pattern="native Yoga" src/screens/retainedShowLifecycleIOS.test.mjs
```

On Windows use an MSVC developer shell and Ninja, and set
`$env:PIT_YOGA_LAYOUT_PROBE` to the generated `.exe`. Multi-configuration
generators may put the executable under `Release/`. Without the variable, only
these supplemental engine cases explicitly skip; the JS lifecycle cases run.

The old percentage flex-basis rule is an intentional negative control. The
production-style cases must pass independently. This gate does not prove UIKit
glyph rendering, accessibility focus or native hit-testing: the Mac acceptance
must still change Dynamic Type on the same mounted page in both directions.
