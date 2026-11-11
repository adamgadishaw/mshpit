import EventAccountControls from "../features/eventAccounts/EventAccountPanel";
import CreatorPostsSection from "../features/creatorPosts/CreatorPostsSection";

// Composition boundary shared by the festival route and event-detail screen.
// Feature slices keep their own services and do not import each other's UI.
export default function EventAccountPanel(props) {
  return <EventAccountControls {...props} renderUpdates={section => <CreatorPostsSection {...section} />} />;
}
