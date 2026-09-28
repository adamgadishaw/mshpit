import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCommentRead } from "./commentReadProjection.mjs";

test("comment refresh removes omitted settled content, keeps pending writes and updates all identity claims",()=>{
  const row={id:"c",userId:"artist",text:"hi",createdAt:1,role:"artist",verified:true,membershipBadge:"first-wave",likes:2,liked:true};
  const existing=reconcileCommentRead([],[row,{id:"hidden",createdAt:2,text:"hidden"}]);
  const pending={id:"pending",at:3,text:"not saved",pending:true};
  const result=reconcileCommentRead([...existing,pending],[{...row,role:"fan",verified:false,membershipBadge:null,avatarUri:"new",name:"new",profileUpdatedAt:5,likes:1,liked:false,canLike:false}]);
  assert.deepEqual(result.map(c=>c.id),["c","pending"]);
  assert.equal(result[0].verified,false);assert.equal(result[0].role,"fan");assert.equal(result[0].membershipBadge,null);
  assert.equal(result[0].avatarUri,"new");assert.equal(result[0].profileUpdatedAt,5);assert.equal(result[0].canLike,false);
  assert.equal(result[0].likes,1);assert.equal(result[0].liked,false);
  assert.equal(result[1],pending);
  assert.equal(reconcileCommentRead(result,[{...row,role:"fan",verified:false,membershipBadge:null,avatarUri:"new",name:"new",profileUpdatedAt:5,likes:1,liked:false,canLike:false}]),result);
});

test("a deleted ancestor is retained only as the server tombstone",()=>{
  const before=[{id:"parent",text:"private",verified:true,at:1},{id:"child",text:"reply",at:2}];
  const next=reconcileCommentRead(before,[{id:"parent",deleted:true,text:"",createdAt:1,userId:null},{id:"child",text:"reply",createdAt:2,parentId:"parent"}]);
  assert.equal(next[0].text,"");assert.equal(next[0].verified,false);assert.equal(next[0].userId,null);
  assert.equal(next[1].parentId,"parent");
});
