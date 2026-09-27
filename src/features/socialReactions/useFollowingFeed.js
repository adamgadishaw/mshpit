import { useEffect, useRef, useState } from "react";
import { readFollowingFeed, subscribeSocialReactionChanges } from "./socialReactionsApi";

const empty = (scope) => ({ scope, posts: [], nextCursor: null, status: "loading", loaded: false });
export default function useFollowingFeed({ accountId, enabled, privacyScope }) {
  const scope = JSON.stringify([accountId || null,privacyScope]);
  const [state,setState] = useState(() => empty(scope));
  const current = useRef({scope,accountId,enabled,state:null,request:null,epoch:0});
  if (current.current.scope !== scope || current.current.enabled !== enabled) {
    current.current.request?.controller.abort(); current.current.epoch++;
    current.current.request=null;
  }
  Object.assign(current.current,{scope,accountId,enabled});
  current.current.state=state.scope===scope ? state : empty(scope);
  const request = async (more = false) => {
    const live=current.current;
    if (!live.accountId || !live.enabled || live.request || (more && !live.state.nextCursor)) return false;
    const token={scope:live.scope,epoch:live.epoch,controller:new AbortController()};
    live.request=token;
    setState(previous=>({...((previous.scope===token.scope) ? previous : empty(token.scope)),status:"loading"}));
    const valid=()=>current.current.request===token && current.current.scope===token.scope && current.current.epoch===token.epoch && !token.controller.signal.aborted;
    try {
      const result=await readFollowingFeed({accountId:live.accountId,cursor:more ? live.state.nextCursor : null,signal:token.controller.signal});
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
    } finally { if (current.current.request===token) current.current.request=null; }
  };
  const requestRef=useRef(request); requestRef.current=request;
  useEffect(()=>{
    if (!enabled || !accountId) return undefined;
    void requestRef.current();
    // Do not collapse a member's expanded history while they are reading it.
    // Deeper pages refresh on explicit refresh, follow/repost change or re-entry.
    const timer=setInterval(()=>{ if (current.current.state.posts.length<=30) void requestRef.current(); },45_000);
    const unsubscribe=subscribeSocialReactionChanges((changed)=>{ if (changed===accountId) void requestRef.current(); });
    return ()=>{ clearInterval(timer); unsubscribe(); current.current.request?.controller.abort(); current.current.request=null; current.current.epoch++; };
  },[scope,enabled,accountId]);
  useEffect(()=>()=>{ current.current.request?.controller.abort(); },[]);
  return { ...(state.scope===scope ? state : empty(scope)), reload:()=>request(false),loadMore:()=>request(true) };
}
