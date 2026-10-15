import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { colors, displayFont, font, radius } from "../../theme";
import Icon from "../Icon";

// Native card content stays in normal flow: neither a slow image nor larger
// text can leave the event name outside a zero-height absolute parent.
export default function DiscoverEventCard({ current, media, date, onOpen, onImageError, onPrevious, onNext, index, count }) {
  const { fontScale } = useWindowDimensions();
  return <View style={styles.shell}>
    <View style={styles.card}>
      <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole="button"
        accessibilityLabel={`Open ${current.title}. ${date}. ${[current.venue,current.place].filter(Boolean).join(", ")}`}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <View style={styles.art}>
          <View style={styles.fallback} accessible={false}><Icon name="music" size={44} color={colors.amber} /></View>
          {media ? <Image source={{ uri:media.uri }} style={StyleSheet.absoluteFill} contentFit={media.source === "catalog" ? "contain" : "cover"}
            cachePolicy="memory-disk" enforceEarlyResizing recyclingKey={media.uri} accessible={false} onError={onImageError} /> : null}
        </View>
        <View style={styles.copy}>
          <Text style={styles.date}>{date}</Text>
          <Text style={styles.title} numberOfLines={fontScale > 1.25 ? undefined : 3}>{current.title}</Text>
          <Text style={styles.detail}>{[current.venue,current.place].filter(Boolean).join(" · ")}</Text>
          <View style={styles.open}><Text style={styles.openText}>View event</Text><Icon name="chevron-right" size={18} color={colors.amber} /></View>
        </View>
      </Pressable>

    </View>
    {count>1 ? <View style={styles.controls} accessibilityLabel="Event slideshow controls">
      <Pressable onPress={onPrevious} accessibilityRole="button" accessibilityLabel="Previous event" style={styles.control}><Icon name="chevron-left" size={18} color={colors.text}/></Pressable>
      <Text style={styles.counter}>{index+1} / {count}</Text>
      <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel="Next event" style={styles.control}><Icon name="chevron-right" size={18} color={colors.text}/></Pressable>
    </View> : null}
  </View>;
}
const styles=StyleSheet.create({
  shell:{width:"100%",minWidth:0,gap:8},card:{borderWidth:1,borderColor:colors.lineSoft,borderRadius:radius.md,overflow:"hidden",backgroundColor:colors.surface},
  action:{minHeight:48},art:{width:"100%",aspectRatio:16/9,overflow:"hidden",backgroundColor:colors.surfaceAlt},fallback:{...StyleSheet.absoluteFill,alignItems:"center",justifyContent:"center",backgroundColor:colors.surfaceAlt},
  copy:{padding:14,gap:6},date:{color:colors.amber,fontFamily:font,fontSize:12,fontWeight:"700"},title:{color:colors.text,fontFamily:displayFont,fontSize:20,fontWeight:"800"},detail:{color:colors.textDim,fontFamily:font,fontSize:14,lineHeight:20},
  open:{minHeight:48,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},openText:{color:colors.amber,fontFamily:font,fontSize:14,fontWeight:"700"},
  pressed:{opacity:.82},credits:{borderTopWidth:StyleSheet.hairlineWidth,borderColor:colors.lineSoft,paddingHorizontal:14},creditToggle:{minHeight:48,flexDirection:"row",alignItems:"center",gap:8},creditText:{color:colors.textDim,fontFamily:font,fontSize:12,flexShrink:1},creditDetails:{paddingBottom:12,gap:4},creditLink:{minHeight:48,flexDirection:"row",alignItems:"center",gap:8},
  controls:{flexDirection:"row",alignItems:"center",justifyContent:"flex-end",gap:8},control:{width:48,height:48,alignItems:"center",justifyContent:"center",borderRadius:24,borderWidth:1,borderColor:colors.lineSoft,backgroundColor:colors.surface},counter:{color:colors.textDim,fontFamily:font,fontSize:12},
});
