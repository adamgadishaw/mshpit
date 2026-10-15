import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font } from "../theme";
const safe = value => { try { const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&!url.port?url.toString():null; } catch { return null; } };
// Details-only credit for the actual Discover image that led to this event.
// A provider name is not a license; only supplied license metadata is shown.
export default function EventPhotoCredit({ credit }) {
  if (!credit || typeof credit.creator!=="string" || !credit.creator.trim()) return null;
  const source=safe(credit.sourcePage),license=safe(credit.licenseUrl);
  const open=url=>{void Linking.openURL(url).catch(()=>console.warn("Photo credit could not be opened."));};
  return <View style={styles.box}>
    <Text style={styles.title}>Discover photo credits</Text><Text style={styles.text}>{credit.creator}</Text>
    {source?<Pressable accessibilityRole="link" accessibilityLabel={`Open original photo by ${credit.creator}`} style={styles.link} onPress={()=>open(source)}><Text style={styles.linkText}>Original photo</Text></Pressable>:null}
    {license&&typeof credit.license==="string"&&credit.license.trim()?<Pressable accessibilityRole="link" accessibilityLabel={`Open ${credit.license} license terms`} style={styles.link} onPress={()=>open(license)}><Text style={styles.linkText}>{credit.license}</Text></Pressable>:null}
  </View>;
}
const styles=StyleSheet.create({box:{marginTop:16,paddingVertical:12,gap:4,borderTopWidth:StyleSheet.hairlineWidth,borderColor:colors.lineSoft},title:{color:colors.text,fontFamily:font,fontSize:14,fontWeight:"700"},text:{color:colors.textDim,fontFamily:font,fontSize:13},link:{minHeight:48,justifyContent:"center",alignSelf:"flex-start"},linkText:{color:colors.amber,fontFamily:font,fontSize:13,textDecorationLine:"underline"}});
