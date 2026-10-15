import { StyleSheet, View } from 'react-native';

// A direct media viewer covers the same Feed instance, preserving the list's
// native scroll position and avoiding a full list remount on every close.
export default function NativeFeedMediaLayer({ obscured, header, tabBar, children, media }) {
  return <View style={styles.fill}>
    <View style={[styles.fill, obscured && styles.hidden]}
      pointerEvents={obscured ? 'none' : 'auto'}
      accessibilityElementsHidden={!!obscured}
      importantForAccessibility={obscured ? 'no-hide-descendants' : 'auto'}>
      {header}{children}{tabBar}
    </View>
    {obscured ? <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>{media}</View> : null}
  </View>;
}

const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 }, hidden: { opacity: 0 } });
