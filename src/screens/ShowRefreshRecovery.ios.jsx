import { Pressable, Text, View } from "react-native";

// Recovery is local to the current Show read. It owns no requests or cache.
export function isTransientShowReadFailure(error) {
  if (error?.name !== "AppError" || error.retryable !== true || error.diagnosticSuppressed === true) return false;
  const status = Number(error.status);
  if ([401, 403, 404, 409, 410].includes(status) || error.serverCode === "IDENTITY_CHANGED"
    || String(error.code || "").startsWith("PIT-AUTH-")) return false;
  if (status === 429 && error.code === "PIT-RATE-001") return true;
  const transportStatus = status === 0 || status === 408 || (status >= 200 && status < 300) || (status >= 500 && status < 600);
  return (transportStatus && ["PIT-NET-001", "PIT-NET-002"].includes(error.code))
    || (status >= 500 && status < 600 && ["PIT-SVC-001", "PIT-SVC-002"].includes(error.code));
}

export function isRetainedShowDocument(read, identity) {
  return read?.identity === identity && read.status === "stale" && read.show?.provider?.backed === true;
}

export function restrictedShowAvailabilityCopy({ allowTickets, artistIdentityPending, artistChecking, artistUnavailable }) {
  if (allowTickets) return null;
  if (artistIdentityPending) return "This listing's artist identity still needs a confirmed match. Profile, ratings and archive links are paused. The last confirmed event details are shown above.";
  if (artistChecking) return "Confirming this artist's profile and status. You can still view the last confirmed event details.";
  if (artistUnavailable) return "We couldn't check this artist right now. The last confirmed event details are still here. Try the artist check again shortly.";
  return null;
}

export default function ShowRefreshNotice({ styles, onRetry, refreshing }) {
  return (
    <View style={styles.reviewUnavailable}>
      <View style={styles.reviewUnavailableCopy}>
        <Text style={styles.reviewUnavailableTitle} accessibilityRole="alert">Show details couldn’t refresh</Text>
        <Text style={styles.reviewUnavailableText}>Showing the last confirmed show details. Try again to check for updates.</Text>
        <Pressable style={styles.reviewUnavailableRetry} onPress={onRetry} disabled={refreshing}
          accessibilityRole="button" accessibilityLabel="Retry refreshing show details"
          accessibilityState={{ disabled: refreshing, busy: refreshing }}>
          <Text style={styles.reviewUnavailableRetryText}>{refreshing ? "Refreshing…" : "Try again"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
