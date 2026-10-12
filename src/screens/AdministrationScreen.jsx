import { lazy, Suspense, useState } from "react";
import { View, Text } from "react-native";
import SheetHeader from "../components/SheetHeader";
import JobsPanel from "../features/jobs/JobsPanel";
import { colors } from "../theme";
const ArtistAccessPanel = lazy(() => import("../features/artistAccess/ArtistAccessPanel"));
export default function AdministrationScreen({ session, onClose }) {
  const [section, setSection] = useState("jobs");
  if (session?.role !== "admin") return <View style={{ flex: 1, backgroundColor: colors.bg }}><SheetHeader title="Administration" onClose={onClose} /><Text style={{ color: colors.text, padding: 24 }}>Administration is available to administrators.</Text></View>;
  return section === "artistAccess"
    ? <Suspense fallback={<View style={{ flex: 1, backgroundColor: colors.bg }}><SheetHeader title="Administration" onClose={onClose} /><Text style={{ color: colors.text, padding: 24 }}>Loading artist access…</Text></View>}><ArtistAccessPanel key={`${session.id}:${session.role}`} accountId={session.id} onClose={onClose} onOpenJobs={() => setSection("jobs")} /></Suspense>
    : <JobsPanel key={`${session.id}:${session.role}`} accountId={session.id} onClose={onClose} onOpenArtistAccess={() => setSection("artistAccess")} />;
}
