import { useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import Button from "../../components/Button";
import { colors, font } from "../../theme";
import { createLoadState, beginLoadState, resolveLoadState, rejectLoadState } from "../../domain/loadState.mjs";
import { toAppError } from "../../lib/diagnostics";
import { publishedNewsPostId } from "./newsDeskEditorApi.mjs";
import { readSourceCredits, saveSourceCredit, saveSourceEdition } from "./sourceRegistryService";
const empty = () => ({ kind:"reporting", name:"", url:"", credit:"", licence:"", edition:"", position:0 });
const kinds = ["reporting","photographs","video","music","data"];
const copy = { color:colors.textDim, fontFamily:font, fontSize:14, lineHeight:22 };
const publicUrl = path => Platform.OS === "web" ? path : `https://www.mshpit.com${path}`;
export default function SourceRegistryEditor({ accountId }) {
  const [link,setLink] = useState("");
  const [mode,setMode] = useState("article");
  const [edition,setEdition] = useState({slug:"",title:"",status:"draft",revision:0});
  const [resource,setResource] = useState(() => createLoadState({scope:accountId}));
  const [source,setSource] = useState(empty);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const serial = useRef(0);
  const article = mode==="article" ? resource.data?.articles?.[0] : resource.data?.editions?.[0] ? {postId:"",headline:resource.data.editions[0].title,credits:resource.data.editions[0].credits} : null;
  const load = async () => {
    const postId = mode==="article" ? publishedNewsPostId(link) : "";
    if (mode==="article" && !postId) { setMessage("Enter the published article link."); return; }
    if (mode==="edition" && !edition.slug) { setMessage("Enter an edition link name."); return; }
    const ticket = ++serial.current;
    setResource(current => beginLoadState(current,{scope:accountId,retainData:false})); setSource(empty()); setMessage("");
    try { const data = await readSourceCredits({accountId,postId,edition:mode==="edition"?edition.slug:""}); if(ticket===serial.current) {setResource(resolveLoadState({scope:accountId,data}));if(mode==="edition" && data.editions[0]) setEdition(data.editions[0]);} }
    catch(error) { if(ticket===serial.current) setResource(current => rejectLoadState(current,{scope:accountId,error:toAppError(error),retainData:false})); }
  };
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await saveSourceCredit({accountId,source:{...source,postId:article.postId,edition:mode==="edition"?edition.slug:source.edition}});
      const data = await readSourceCredits({accountId,postId:article.postId,edition:mode==="edition"?edition.slug:""});
      setResource(resolveLoadState({scope:accountId,data})); setSource({...source,id:result.source.id,revision:result.source.revision}); setMessage("Credit saved. Article content is unchanged.");
    } catch(error) { setMessage(toAppError(error).message); }
    finally { setBusy(false); }
  };
  return <View style={{marginVertical:24,gap:14,borderTopWidth:1,borderColor:colors.lineSoft,paddingTop:24}}>
    <Text style={{...copy,color:colors.text,fontSize:22,fontWeight:"800"}}>Sources</Text>
    <Text style={copy}>Add or correct article credits, or create an edition for a video or collection. Editions have their own shareable link.</Text>
    <View style={{flexDirection:"row",gap:8}}>{["article","edition"].map(value=><Button key={value} title={value==="article"?"Article":"Edition"} variant={mode===value?"primary":"secondary"} disabled={busy} onPress={()=>{serial.current++;setMode(value);setResource(createLoadState({scope:accountId}));setSource(empty());setMessage("");}} />)}</View>
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(publicUrl("/promotion-sources"))}><Text style={{...copy,color:colors.gold}}>Open sources directory</Text></Pressable>
    {mode==="article" ? <><Text style={copy}>Published article link</Text>
    <TextInput accessibilityLabel="Published article link for sources" value={link} onChangeText={setLink} editable={!busy} style={{...copy,borderWidth:1,borderColor:colors.lineSoft,padding:12}} /></> : <>
      {[["slug","Edition link name (lowercase words with hyphens)"],["title","Edition title"]].map(([key,label])=><View key={key}><Text style={copy}>{label}</Text><TextInput accessibilityLabel={label} value={edition[key]} editable={!busy && (key!=="slug" || !edition.revision)} onChangeText={value=>setEdition({...edition,[key]:value})} style={{...copy,borderWidth:1,borderColor:colors.lineSoft,padding:12}} /></View>)}
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{["draft","published","withdrawn"].map(status=><Button small key={status} title={status} disabled={busy} variant={edition.status===status?"primary":"secondary"} onPress={()=>setEdition({...edition,status})} />)}</View>
      <Button title="Save edition" disabled={busy} onPress={async()=>{setBusy(true);try{const result=await saveSourceEdition({accountId,edition:{slug:edition.slug,title:edition.title,status:edition.status,revision:edition.revision}});setEdition(result.edition);setMessage("Edition saved. Load its credits to continue.");}catch(error){setMessage(toAppError(error).message);}finally{setBusy(false);}}} />
      {edition.revision ? <Pressable accessibilityRole="link" onPress={()=>Linking.openURL(publicUrl(`/promotion-sources?edition=${encodeURIComponent(edition.slug)}`))}><Text style={{...copy,color:colors.gold}}>Open this edition’s sources</Text></Pressable> : null}
      <Button title="New edition" variant="secondary" disabled={busy} onPress={()=>{setEdition({slug:"",title:"",status:"draft",revision:0});setResource(createLoadState({scope:accountId}));setSource(empty());}} />
    </>}
    <Button title="Load credits" onPress={load} disabled={busy || resource.status==="loading"} />
    {resource.status==="loading" ? <Text style={copy}>Loading credits…</Text> : null}
    {resource.error ? <Text accessibilityRole="alert" style={copy}>{resource.error.message}</Text> : null}
    {resource.status==="ready" && !article ? <Text style={copy}>No available public article matches that link.</Text> : null}
    {article ? <>
      <Text style={{...copy,fontWeight:"800"}}>{article.headline}</Text>
      {article.credits.map((item,index) => <View key={item.id || index} style={{gap:6}}>
        <Text style={copy}>{item.name} · {item.kind}{item.credit ? ` — ${item.credit}` : ""}</Text>
        <Button small variant="secondary" title={item.id ? "Edit credit" : "Add attribution details"} disabled={busy} onPress={() => {
          setSource({...empty(),kind:item.kind,name:item.name,url:item.url,credit:item.credit || "",licence:item.licence || "",edition:item.edition || "",position:item.position || 0,...(item.id?{id:item.id,revision:item.revision}:{})}); setMessage("");
        }} />
      </View>)}
      <Button small variant="secondary" title="Add source" disabled={busy} onPress={() => {setSource(empty());setMessage("");}} />
      <Text style={copy}>{source.id ? "Edit source" : "New source"}</Text>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{kinds.map(kind => <Button key={kind} small title={kind} variant={source.kind===kind?"primary":"secondary"} disabled={busy} onPress={() => setSource({...source,kind})} />)}</View>
      {[["name","Creator or source name"],["url","Original HTTPS link"],["credit","Credit text"],["licence","Known licence and required attribution (leave blank if unknown)"],...(mode==="article"?[["edition","Existing edition link name (optional)"]]:[]),["position","Display order"]].map(([key,label]) => <View key={key} style={{gap:6}}>
        <Text style={copy}>{label}</Text><TextInput accessibilityLabel={label} value={String(source[key])} multiline={key === "credit" || key === "licence"} numberOfLines={key === "credit" || key === "licence" ? 4 : 1} editable={!busy} maxLength={key==="position"?6:key==="url"?2048:1000} onChangeText={value => setSource({...source,[key]:key==="position"?Number(value):value})} style={{...copy,borderWidth:1,borderColor:colors.lineSoft,padding:12}} />
      </View>)}
      <Button title="Save source" onPress={save} disabled={busy} loading={busy} />
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={copy}>{message}</Text> : null}
  </View>;
}
