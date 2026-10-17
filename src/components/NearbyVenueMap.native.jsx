import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { colors, focusRing, radius } from "../theme";
import { linearProjector } from "../lib/mapProject";
import { mapPoint } from "../domain/mapCoordinates.mjs";

// Coordinates are real; this deliberately draws no invented roads/geography.
export default function NearbyVenueMap({ points = [], highlight, label, onOpenVenue }) {
  const [selected, setSelected] = useState(null);
  const rows = useMemo(() => points.map(mapPoint).filter(Boolean), [points]);
  const center = mapPoint(highlight);
  const projection = linearProjector(center ? [...rows, center] : rows);
  const active = rows.find(p => p.name === selected);
  return <View>
    <View style={styles.heading}><Text style={styles.label}>Venue locations</Text><Text style={styles.caption}>N ↑ · coordinate overview</Text></View>
    <View style={styles.plot}>
      <Svg width="100%" height="100%" viewBox="0 0 320 206" accessible={false}>
        <Line x1="160" y1="12" x2="160" y2="194" stroke={colors.lineSoft} />
        <Line x1="12" y1="103" x2="308" y2="103" stroke={colors.lineSoft} />
        {rows.map(p => <Circle key={p.name} cx={projection.xPct(p.lng)*320} cy={projection.yPct(p.lat)*206} r={selected === p.name ? 6 : 3} fill={selected === p.name ? colors.amber : colors.textFaint} />)}
        {center ? <Circle cx={projection.xPct(center.lng)*320} cy={projection.yPct(center.lat)*206} r="6" fill={colors.amber} stroke={colors.bg} strokeWidth="2" /> : null}
      </Svg>
      {rows.map(p => <Pressable key={p.name} accessibilityRole="button" accessibilityLabel={"Select venue " + p.name} accessibilityState={{ selected: selected === p.name }} onPress={() => setSelected(p.name)} style={[styles.hit, { left: (projection.xPct(p.lng)*100)+"%", top: (projection.yPct(p.lat)*100)+"%" }]} />)}
    </View>
    <Text style={styles.caption}>Amber: {label || "your city"}. Locations are approximate; this is not a street map.</Text>
    {active ? <Pressable onPress={() => onOpenVenue?.(active.name)} accessibilityRole="button" accessibilityLabel={"Open " + active.name} style={({focused})=>[styles.selected,focused && focusRing]}><Text style={styles.label}>{active.name}</Text><Text style={styles.caption}>Open venue →</Text></Pressable> : <Text style={styles.caption}>Tap a venue dot to select it. Use the list for nearby overlapping locations.</Text>}
    {center ? <Pressable onPress={() => void Linking.openURL("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(center.lat+","+center.lng))} accessibilityRole="link" style={styles.selected}><Text style={styles.link}>Open city in Maps ↗</Text></Pressable> : null}
  </View>;
}
const styles=StyleSheet.create({ heading:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",padding:8},label:{color:colors.text,fontSize:13,fontWeight:"700"},caption:{color:colors.textFaint,fontSize:11,lineHeight:16,padding:4},plot:{width:"100%",aspectRatio:320/206,backgroundColor:colors.bg,overflow:"hidden",borderRadius:radius.sm},hit:{position:"absolute",width:32,height:32,marginLeft:-16,marginTop:-16},selected:{minHeight:44,padding:10,borderTopWidth:1,borderColor:colors.lineSoft,justifyContent:"center"},link:{color:colors.amber,fontSize:12,fontWeight:"700"}});
