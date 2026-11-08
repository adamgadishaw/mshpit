// Main navigation is deliberately tap-only on iOS. Horizontal paging belongs
// to the Feed filter strip; detail Back has its own independently guarded owner.
export default function NativeTabRail({ children }) {
  return children;
}
