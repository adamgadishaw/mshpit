import { Suspense, useState } from "react";
import { View } from "react-native";
import { lazyWithRetry } from "../lib/lazyWithRetry";

const ReviewDialog = lazyWithRetry(() => import("./ReviewDialog"), "ReviewDialog");

// Keep the actual originating screen mounted, including its scroll/disclosure
// state. A review's child gallery and event page share this bounded visit stack.
// The parent keys this host by account; no retained element crosses identities.
export default function ReviewPresentation({ children, routeKey, depth, review, onClose, fallback }) {
  // Route identity tracks modal visits; it must not remount the native retained
  // stack that owns ordinary detail occurrences. Web keeps keyed transitions.
  const current = { key: routeKey ?? children.key, depth, content: children, review };
  const [stored, setStored] = useState([current]);
  const previous = stored.at(-1);
  const changed = previous.key !== current.key || previous.depth !== depth;
  const retain = (review || stored.some(page => page.review)) && depth > stored[0].depth;
  const pages = [...(changed ? retain ? stored.filter(page => page.depth < depth) : [] : stored.slice(0, -1)), current];
  if (changed || previous.content !== children) setStored(pages);
  const base = pages[0].review ? null : pages[0];
  const modal = pages.slice(base ? 1 : 0);
  return <>
    {base ? <View key="origin" style={fill} pointerEvents={modal.length ? "none" : "auto"}
      aria-hidden={!!modal.length} accessibilityElementsHidden={!!modal.length}
      importantForAccessibility={modal.length ? "no-hide-descendants" : "auto"}>
      <Suspense fallback={fallback}>{base.content}</Suspense>
    </View> : null}
    {modal.length ? <Suspense fallback={fallback}><ReviewDialog review={review} onClose={onClose} pages={modal} fallback={fallback} /></Suspense> : null}
  </>;
}

const fill = { flex: 1, minHeight: 0 };
