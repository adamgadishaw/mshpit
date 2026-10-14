// Native development measurements only. The production tree has no Profiler.
import { Profiler, useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
const measuring = __DEV__ && process.env.EXPO_PUBLIC_NATIVE_PERF === '1';
const state = measuring ? (globalThis.__MSHPIT_NATIVE_PERF__ ||= { commits: [], screens: [], pending: null }) : null;
function commit(id, phase, actualDuration, baseDuration) {
  state.commits.push({ id, phase, actualDuration, baseDuration, at: performance.now() });
  if (state.commits.length > 500) state.commits.shift();
}
export default function ScreenTransition({ children, performanceKey = 'screen' }) {
  useLayoutEffect(() => {
    if (!state) return;
    const pending = state.pending;
    let second;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        state.screens.push({ screen: performanceKey, at: performance.now(),
          label: pending?.label, elapsed: pending ? performance.now() - pending.at : null });
        if (state.screens.length > 100) state.screens.shift();
        if (state.pending === pending) state.pending = null;
      });
    });
    return () => { cancelAnimationFrame(first); if (second != null) cancelAnimationFrame(second); };
  }, [performanceKey]);
  const content = <View style={styles.fill}>{children}</View>;
  return measuring ? <Profiler id={performanceKey} onRender={commit}>{content}</Profiler> : content;
}
const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 } });
