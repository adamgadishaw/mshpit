import { forwardRef, useCallback, useEffect, useRef } from "react";
import { ScrollView } from "react-native";
import { assignScrollRef, scrollPageToTop } from "../domain/pageReturn.mjs";
import { usePageReturn } from "./PageReturnContext";

// Static pages and forms return to top without remounting or losing drafts.
// Horizontal pickers never register as the page's vertical scroll owner.
export default forwardRef(function PageScrollView(props, forwardedRef) {
  const page = usePageReturn();
  const scrollRef = useRef(null);
  const setRef = useCallback((value) => {
    scrollRef.current = value;
    assignScrollRef(forwardedRef, value);
  }, [forwardedRef]);
  useEffect(() => props.horizontal ? undefined : page?.register(() => scrollPageToTop(scrollRef.current), false), [page, props.horizontal]);
  return <ScrollView {...props} ref={setRef} />;
});
