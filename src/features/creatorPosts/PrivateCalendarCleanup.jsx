import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Button from '../../components/Button';
import { colors, radius } from '../../theme';
import { api } from '../../lib/api';
import { fetchArtistCalendar } from './creatorPostsApi.mjs';
import { confirmedPrivateWithdrawal, privateCalendarWithdrawal } from './privateCalendarCleanup.mjs';

export default function PrivateCalendarCleanup({ accountId }) {
  const [open,setOpen]=useState(false),[page,setPage]=useState(''),[reload,setReload]=useState(0);
  const [resource,setResource]=useState({accountId,status:'idle',events:[]});
  const [confirmation,setConfirmation]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
  const scope=useRef(accountId),controllers=useRef(new Set()),attempts=useRef(new Map()),inFlight=useRef(false);
  scope.current=accountId;
  useEffect(()=>{
    setConfirmation(null);setNotice(null);setPage('');setBusy(false);inFlight.current=false;
    return()=>{for(const controller of controllers.current)controller.abort();attempts.current.clear();};
  },[accountId]);
  useEffect(()=>{
    if(!open||!accountId)return;
    const controller=new AbortController();controllers.current.add(controller);
    setResource({accountId,status:'loading',events:[]});setConfirmation(null);
    fetchArtistCalendar({accountId,after:page,signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted&&scope.current===accountId)setResource({accountId,status:'ready',...data});
    }).catch(error=>{
      if(!controller.signal.aborted&&scope.current===accountId)setResource({accountId,status:'error',events:[],error:error.userMessage||error.message});
    }).finally(()=>controllers.current.delete(controller));
    return()=>controller.abort();
  },[accountId,open,page,reload]);
  const current=resource.accountId===accountId?resource:{status:'loading',events:[]};
  const message=notice?.accountId===accountId?notice:null;
  const rows=(current.events||[]).filter(event=>event.withdrawal||event.cleanupMediaAssetIds?.length||event.publicationState==='cancelled');
  const run=async(event,kind)=>{
    if(inFlight.current||!accountId)return;
    inFlight.current=true;setBusy(true);setNotice(null);
    const controller=new AbortController();controllers.current.add(controller);
    const active=()=>!controller.signal.aborted&&scope.current===accountId;
    try{
      if(kind==='withdraw'){
        const key=`${event.id}:${event.revision}`;
        if(!attempts.current.has(key))attempts.current.set(key,privateCalendarWithdrawal(event,`withdraw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`));
        const body=attempts.current.get(key);
        const result=await api('/api/posts',{method:'POST',body,expectedAccountId:accountId,signal:controller.signal,silent:true,context:'Withdrawing your private scheduled show'});
        if(!active())return;
        if(!confirmedPrivateWithdrawal(result,body))throw new Error('Withdrawal could not be confirmed. Retry this same request or refresh your calendar.');
      }else{
        for(const assetId of event.cleanupMediaAssetIds||[]){
          if(!active())return;
          await api(`/api/media/assets/${encodeURIComponent(assetId)}`,{method:'DELETE',expectedAccountId:accountId,signal:controller.signal,silent:true,context:'Removing an unused scheduled-show upload'});
        }
      }
      if(active()){
        setNotice({accountId,text:kind==='withdraw'?'Show withdrawn. No update was published.':'Unused uploads removed.'});
        setConfirmation(null);setReload(value=>value+1);
      }
    }catch(error){
      if(active())setNotice({accountId,error:true,text:error.userMessage||error.message||'This could not be completed. Refresh your calendar before trying again.',
        retry:![400,401,403,404,409].includes(error.status)?{event,kind}:null});
    }finally{controllers.current.delete(controller);if(active()){inFlight.current=false;setBusy(false);}}
  };
  return <View style={{gap:12}}>
    <Button title="Manage private scheduled shows" variant="secondary" disabled={busy} onPress={()=>setOpen(value=>!value)} />
    {open&&<View style={{gap:14,padding:16,borderWidth:1,borderColor:colors.line,borderRadius:radius.lg,backgroundColor:colors.surface}}>
      <Text accessibilityRole="header" style={{color:colors.text,fontWeight:'800',fontSize:18}}>Private scheduled shows</Text>
      <Text style={{color:colors.textDim}}>Withdraw a show that has never been published. This sends no follower update and does not change your permission to publish.</Text>
      <Button title="Refresh private calendar" small variant="secondary" disabled={busy||current.status==='loading'} onPress={()=>{setNotice(null);setReload(value=>value+1);}} />
      {current.status==='loading'&&<ActivityIndicator accessibilityLabel="Loading private scheduled shows" color={colors.amber} />}
      {current.status==='error'&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{current.error}</Text>}
      {message&&<Text accessibilityRole={message.error?'alert':undefined} accessibilityLiveRegion="polite" style={{color:message.error?colors.danger:colors.text}}>{message.text}</Text>}
      {message?.retry&&<Button title={message.retry.kind==='withdraw'?'Retry withdrawal':'Retry removing uploads'} disabled={busy} onPress={()=>run(message.retry.event,message.retry.kind)} />}
      {current.status==='ready'&&!rows.length&&<Text style={{color:colors.textDim}}>No private schedules to withdraw on this page.</Text>}
      {rows.map(event=>{
        const label=`${event.venue} on ${event.date}`,confirm=confirmation?.id===event.id?confirmation:null;
        return <View key={event.id} style={{gap:10,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
          <Text style={{color:colors.text,fontWeight:'700'}}>{label}</Text>
          <Text style={{color:colors.textDim}}>{event.place} · {event.publicationState==='cancelled'?'Withdrawn':event.publicationState==='blocked'?'Publication blocked':'Scheduled privately'}</Text>
          {event.withdrawal&&<Button title={`Withdraw ${label}`} small variant="secondary" disabled={busy||!!message?.error} onPress={()=>setConfirmation({id:event.id,kind:'withdraw'})} />}
          {!!event.cleanupMediaAssetIds?.length&&<Button title={`Remove unused uploads for ${label}`} small variant="secondary" disabled={busy||!!message?.error} onPress={()=>setConfirmation({id:event.id,kind:'cleanup'})} />}
          {confirm&&<View style={{gap:8}}>
            <Text style={{color:colors.textDim}}>{confirm.kind==='withdraw'?'Withdraw this private show? Its saved history is retained and no post is published.':'Remove these unused uploads? Media used by another post or scheduled show will be kept.'}</Text>
            <Button title={busy?'Working...':confirm.kind==='withdraw'?`Confirm withdrawal for ${label}`:`Confirm upload removal for ${label}`} disabled={busy||!!message?.error} onPress={()=>run(event,confirm.kind)} />
            <Button title="Keep it" small variant="secondary" disabled={busy} onPress={()=>setConfirmation(null)} />
          </View>}
        </View>;
      })}
      {!!current.nextCursor&&<Button title="Next calendar page" small variant="secondary" disabled={busy} onPress={()=>setPage(current.nextCursor)} />}
      {!!page&&<Button title="First calendar page" small variant="secondary" disabled={busy} onPress={()=>setPage('')} />}
    </View>}
  </View>;
}
