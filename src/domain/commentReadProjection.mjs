// The server supplies the current visible window, not an append-only delta.
// Keep pending local writes only; settled omissions may be privacy revocations.
export function reconcileCommentRead(existing, rows) {
  const byId=new Map(existing.filter(comment => comment.pending).map(comment => [comment.id,comment]));
  for (const c of rows) byId.set(c.id, {
    id:c.id,userId:c.userId,name:c.name,initials:c.initials,avatarUri:c.avatarUri,avatarColor:c.avatarColor,
    profileUpdatedAt:c.profileUpdatedAt || 0,role:c.role,verified:!!c.verified,membershipBadge:c.membershipBadge || null,
    text:c.text,deleted:!!c.deleted,parentId:c.parentId || null,at:c.createdAt,
    likes:Math.max(0,Number(c.likes)||0),liked:!!c.liked,canLike:c.canLike !== false,
  });
  const next=[...byId.values()].sort((a,b)=>(a.at||0)-(b.at||0) || String(a.id).localeCompare(String(b.id)));
  const fields=["text","deleted","parentId","at","likes","liked","canLike","membershipBadge","userId","name","initials","avatarUri","avatarColor","profileUpdatedAt","role","verified","pending"];
  return next.length===existing.length && next.every((row,index)=>existing[index]?.id===row.id && fields.every(key=>existing[index][key]===row[key])) ? existing : next;
}
