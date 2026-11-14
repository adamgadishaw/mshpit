import { useEffect, useRef, useState } from "react";
import { readFollowingFeed, readLocalFeed, subscribeSocialReactionChanges } from "./socialReactionsApi";
import { subscribeAuthorBadgeChanges } from "../../domain/authorBadgeChanges.mjs";
import { reconcilePostAuthorBadges } from "../../domain/postBadgeBundle.mjs";

const empty = (scope) => ({ scope, posts: [], nextCursor: null, status: "loading", loaded: false });
export default function useFollowingFeed({ accountId, enabled, privacyScope, mode = "following", homeCity = null }) {
  const scope = JSON.stringify([accountId || null,privacyScope,mode,homeCity]);
  const [state,setState] = useState(() => empty(scope));
  const current = useRef({scope,accountId,enabled,state:null,request:null,refreshQueued:false,epoch:0});
  if (current.current.scope !== scope || current.current.enabled !== enabled) {
    current.current.request?.controller.abort(); current.current.epoch++;
    current.current.request=null; current.current.refreshQueued=false;
  }
  Object.assign(current.current,{scope,accountId,enabled});
  current.current.state=state.scope===scope ? state : empty(scope);
  const request = async (more = false) => {
    const live=current.current;
    if (!live.accountId || !live.enabled || (more && (live.request || !live.state.nextCursor))) return false;
    if (!more && live.request) { live.request.controller.abort(); live.request=null; live.epoch++; }
    const token={scope:live.scope,epoch:live.epoch,controller:new AbortController()};
    live.request=token;
    setState(previous=>({...((previous.scope===token.scope) ? previous : empty(token.scope)),status:"loading"}));
    const valid=()=>current.current.request===token && current.current.scope===token.scope && current.current.epoch===token.epoch && !token.controller.signal.aborted;
    try {
      const cursor=more ? live.state.nextCursor : null;
      const result=mode === "following"
        ? await readFollowingFeed({accountId:live.accountId,cursor,signal:token.controller.signal})
        : await readLocalFeed({accountId:live.accountId,cursor,signal:token.controller.signal});
      if (!valid()) return false;
      if (!Array.isArray(result?.posts)) throw new Error("Invalid Following response");
      setState(previous=>{
        const previousPosts=more && previous.scope===token.scope ? previous.posts : [];
        const byId=new Map(previousPosts.map(post=>[post.id,post]));
        for (const post of result.posts) byId.set(post.id,post);
        return {scope:token.scope,posts:[...byId.values()],nextCursor:result.nextCursor || null,status:"ready",loaded:true};
      });
      return true;
    } catch (error) {
      // architecture: allow-ambiguous-result -- retained feed rows remain usable; the visible scoped error offers a retry
      if (valid()) setState(previous=>[401,403,404,410].includes(Number(error?.status))
        ? {...empty(token.scope),status:"error"} : {...previous,status:"error"});
      return false;
    } finally {
      if (current.current.request===token) {
        current.current.request=null;
        // Several completed mutations during pagination need one fresh read,
        // not a lost invalidation or an unbounded queue of duplicate requests.
        const refresh=current.current.refreshQueued;
        current.current.refreshQueued=false;
        if (refresh && current.current.enabled && current.current.scope===token.scope && current.current.epoch===token.epoch) void requestRef.current();
      }
    }
  };
  const requestRef=useRef(request); requestRef.current=request;
  useEffect(()=>{
    if (!enabled || !accountId) return undefined;
    void requestRef.current();
    // Do not collapse a member's expanded history while they are reading it.
    // Deeper pages refresh on explicit refresh, follow/repost change or re-entry.
    const unsubscribe=subscribeSocialReactionChanges((changed)=>{
      if (changed!==accountId || !current.current.enabled || current.current.scope!==scope) return;
      if (current.current.request) current.current.refreshQueued=true;
      else void requestRef.current();
    });
    return ()=>{ unsubscribe(); current.current.request?.controller.abort(); current.current.request=null; current.current.refreshQueued=false; current.current.epoch++; };
  },[scope,enabled,accountId]);
  useEffect(()=>()=>{ current.current.request?.controller.abort(); },[]);
  useEffect(()=>subscribeAuthorBadgeChanges(event=>{
    const live=current.current;
    if(event.accountId!==accountId || !live.enabled || live.scope!==scope) return;
    live.request?.controller.abort(); live.request=null; live.epoch++; live.refreshQueued=false;
    setState(previous=>previous.scope===scope ? {...previous,posts:reconcilePostAuthorBadges(previous.posts,event.user),status:previous.loaded ? "ready" : "loading"} : previous);
    if(!live.state.loaded) void requestRef.current();
  }),[accountId,scope]);
  return { ...(state.scope===scope ? state : empty(scope)), reload:()=>request(false),loadMore:()=>request(true) };
}
