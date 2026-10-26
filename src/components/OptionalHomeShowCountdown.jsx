import { Component, Suspense } from "react";
import { captureAppError } from "../lib/diagnostics";
import { lazyWithRetry } from "../lib/lazyWithRetry";

// Only this optional widget may disappear when its import or render fails.
// Keep one lazy instance for the mounted placement: prop changes must not
// restart a rejected import. A real unmount/remount permits another attempt,
// without retaining React.lazy's rejected promise for the rest of the session.
export default class OptionalHomeShowCountdown extends Component {
  state = { failed: false };
  Countdown = lazyWithRetry(() => import("./HomeShowCountdown"), "HomeShowCountdown");

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    try {
      captureAppError(error, {
        code: "PIT-APP-001",
        context: "Rendering the optional show countdown",
        source: "home-show-countdown",
        toast: false,
      });
    } catch { /* Optional diagnostics must not take down the feed either. */ }
  }

  render() {
    if (this.state.failed) return null;
    const { fallback = null, ...props } = this.props;
    const Countdown = this.Countdown;
    return <Suspense fallback={fallback}><Countdown {...props} /></Suspense>;
  }
}
