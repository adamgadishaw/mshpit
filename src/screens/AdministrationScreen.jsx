import { View, Text } from "react-native";
import SheetHeader from "../components/SheetHeader";
import JobsPanel from "../features/jobs/JobsPanel";
import { colors } from "../theme";
export default function AdministrationScreen({ session, onClose }) {
  if (session?.role !== "admin") return <View style={{ flex: 1, backgroundColor: colors.bg }}><SheetHeader title="Administration" onClose={onClose} /><Text style={{ color: colors.text, padding: 24 }}>Administration is available to administrators.</Text></View>;
  return <JobsPanel key={`${session.id}:${session.role}`} accountId={session.id} onClose={onClose} />;
}
