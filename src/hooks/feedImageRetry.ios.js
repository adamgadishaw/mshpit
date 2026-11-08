import { createContext, createElement, useContext, useLayoutEffect, useRef } from "react";

const RetryContext = createContext(null);
export function FeedImageRetryProvider({ value, children }) {
  return createElement(RetryContext.Provider, { value }, children);
}
export function useFeedImageRetryPulse() { return useContext(RetryContext); }

// This owns only image retry intent. Feed retains its existing data request,
// single-flight controller, indicator, errors and cancellation behavior.
export function useFeedImageRetry(scope) {
  const ownerRef = useRef(null);
  if (!ownerRef.current || ownerRef.current.scope !== scope) {
    const listeners = new Set();
    const owner = { scope, active: true, request: null, listeners };
    owner.value = { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
    ownerRef.current = owner;
  }
  const owner = ownerRef.current;
  useLayoutEffect(() => {
    owner.active = true;
    return () => { owner.active = false; };
  }, [owner]);
  const isCurrent = () => ownerRef.current === owner && owner.active;
  const accept = (signal) => {
    if (!isCurrent() || signal.aborted || owner.request === signal) return;
    owner.request = signal;
    for (const listener of owner.listeners) listener();
  };
  return { value: owner.value, isCurrent, accept };
}
