import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font } from "../theme";
import Icon from "./Icon";

function ReactionButton({ scope, selected, count, label, activeLabel, icon, action, onRequireAuth, accountId }) {
  const [state,setState]=useState({scope,pending:false,error:"",result:null});
  const current=useRef(scope); current.current=scope;
  const pending=useRef(null);
  const scoped=state.scope===scope ? state : {pending:false,error:"",result:null};
  const displayed=scoped.result || {selected,count};
  const press=async()=>{
    if (!accountId) return onRequireAuth?.();
    if (!action || pending.current===scope) return;
    pending.current=scope; setState({scope,pending:true,error:"",result:scoped.result});
    try {
      const result=await action(!displayed.selected);
      if (current.current!==scope) return;
      setState({scope,pending:false,error:result?.ok ? "" : "Not saved. Try again.",result:result?.ok ? result : scoped.result});
    } catch {
      if (current.current===scope) setState({scope,pending:false,error:"Not saved. Try again.",result:scoped.result});
    } finally { if (pending.current===scope) pending.current=null; }
  };
  return <View style={styles.wrap}>
    <Pressable onPress={press} disabled={scoped.pending || (!!accountId && !action)} accessibilityRole="button"
      accessibilityLabel={`${displayed.selected ? activeLabel : label}, ${displayed.count}`}
      accessibilityState={{selected:displayed.selected,disabled:scoped.pending,busy:scoped.pending}}
      style={({pressed})=>[styles.button,pressed && {opacity:0.7}]}>
      <Icon name={icon} size={17} color={displayed.selected ? colors.good : colors.textDim} filled={icon==="heart" && displayed.selected} />
      <Text style={[styles.text,displayed.selected && {color:colors.good}]}>{label === "Repost" ? (displayed.selected ? "Reposted" : "Repost") : "Like"} {displayed.count}</Text>
    </Pressable>
    {scoped.error ? <Text style={styles.error} accessibilityLiveRegion="polite">{scoped.error}</Text> : null}
  </View>;
}

export function RepostButton({ post, accountId, onRepost, onRequireAuth }) {
  return <ReactionButton key={`${accountId || "guest"}:${post.id}:${post.reposts || 0}:${!!post.reposted}`}
    scope={`${accountId || "guest"}:${post.id}`} accountId={accountId} selected={!!post.reposted} count={Number(post.reposts)||0}
    label="Repost" activeLabel="Undo repost" icon="repeat" onRequireAuth={onRequireAuth}
    action={onRepost ? async desired=>{const result=await onRepost(post.id,desired);return {...result,selected:!!result?.reposted,count:Number(result?.reposts)||0};} : null} />;
}

export function CommentLikeButton({ comment, postId, accountId, onLike, onRequireAuth }) {
  return <ReactionButton key={`${accountId || "guest"}:${comment.id}:${comment.likes || 0}:${!!comment.liked}`}
    scope={`${accountId || "guest"}:${postId}:${comment.id}`} accountId={accountId} selected={!!comment.liked} count={Number(comment.likes)||0}
    label="Like comment" activeLabel="Unlike comment" icon="heart" onRequireAuth={onRequireAuth}
    action={onLike ? async desired=>{const result=await onLike(postId,comment.id,desired);return {...result,selected:!!result?.liked,count:Number(result?.likes)||0};} : null} />;
}

export function RepostAttribution({ post, accountId, onOpenProfile }) {
  const actor=post.repostedBy?.[0];
  if (!actor) return null;
  return <Pressable style={styles.attribution} onPress={()=>onOpenProfile?.(actor.userId)} accessibilityRole="link"
    accessibilityLabel={`Open ${actor.name || "reposter's"} profile`}>
    <Icon name="repeat" size={13} color={colors.good} />
    <Text style={styles.text}>{actor.userId===accountId ? "You" : actor.name || "A member"} reposted</Text>
  </Pressable>;
}
const styles=StyleSheet.create({
  wrap:{maxWidth:"100%"}, button:{minHeight:44,flexDirection:"row",alignItems:"center",gap:5,paddingHorizontal:6},
  text:{fontFamily:font,fontSize:12,color:colors.textDim,fontVariant:["tabular-nums"]},
  error:{fontFamily:font,fontSize:11,color:colors.danger},
  attribution:{minHeight:36,flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:12},
});
