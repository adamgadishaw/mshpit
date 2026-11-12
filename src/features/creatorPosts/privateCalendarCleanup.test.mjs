import test from 'node:test';
import assert from 'node:assert/strict';
import { privateCalendarWithdrawal, confirmedPrivateWithdrawal } from './privateCalendarCleanup.mjs';
const event={id:'td_private',revision:3,venue:'The Hall',place:'Toronto, Canada',date:'2027-01-01',ticketUrl:'',publicationState:'blocked',status:'scheduled',withdrawal:{entityKey:'fixture artist'}};
test('withdrawal is limited to a server-confirmed private event and fixed cancellation, without authored media/text or publication fields',()=>{
  const body=privateCalendarWithdrawal({...event,review:'Do not turn this saved draft into a post',photos:['private.jpg']},'withdraw_same_request');
  assert.deepEqual(body,{clientMutationId:'withdraw_same_request',kind:'status',review:'',creatorUpdate:{version:1,entityType:'artist',entityKey:'fixture artist',kind:'show',title:'Scheduled show withdrawn',date:event.date,location:'The Hall, Toronto, Canada',url:'',calendar:{action:'cancel',eventId:event.id,expectedRevision:3,venue:event.venue,place:event.place,releaseAt:0}}});
  for(const patch of [{withdrawal:null},{publicationState:'published'},{publicationState:'cancelled'},{status:'cancelled'},{revision:0},{revision:3.5}])assert.throws(()=>privateCalendarWithdrawal({...event,...patch},'withdraw_same_request'));
});
test('only a matching private cancellation receipt confirms success, never a post or another event/revision',()=>{
  const body=privateCalendarWithdrawal(event,'withdraw_same_request');
  const calendarReceipt={state:'cancelled',mutationId:body.clientMutationId,eventId:event.id,revision:4};
  assert.equal(confirmedPrivateWithdrawal({calendarReceipt},body),true);
  for(const patch of [{state:'published'},{state:'scheduled'},{eventId:'another'},{revision:3},{mutationId:'another'}])assert.equal(confirmedPrivateWithdrawal({calendarReceipt:{...calendarReceipt,...patch}},body),false);
  assert.equal(confirmedPrivateWithdrawal({calendarReceipt,post:{id:'published'}},body),false);
  assert.equal(confirmedPrivateWithdrawal({calendarReceipt,id:'published'},body),false);
});
