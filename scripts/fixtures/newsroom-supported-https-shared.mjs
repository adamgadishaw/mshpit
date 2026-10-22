import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
export const LIMITS = Object.freeze({ milliseconds: 1800000, requests: 200, logins: 2, enables: 2, saves: 2, uploads: 1, mediaCreates: 1, finalizes: 1, publications: 0 });
export const MARKER = 'SYNTHETIC_NEWSROOM_ACCEPTANCE_ONLY';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// A synthetic codec vector, not user artwork: alternating white/black pixels,
// 400ms per frame, looping forever. The browser must display both frames.
export function animatedImage() {
  return Buffer.concat([
    Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
    Buffer.from('21ff0b4e45545343415045322e300301000000', 'hex'),
    ...['4c', '44'].map(pixel => Buffer.from(`21f90400280000002c0000000001000100000201${pixel}00`, 'hex')),
    Buffer.from([0x3b]),
  ]);
}
export function image() {
  const crc32 = bytes => { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0; };
  const chunk = (name,payload) => {const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(payload.length);crc.writeUInt32BE(crc32(Buffer.concat([type,payload])));return Buffer.concat([length,type,payload,crc]);};
  const width=1200,height=900,header=Buffer.alloc(13),rows=Buffer.alloc((width*4+1)*height);
  header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const colors=[[27,91,148,255],[190,40,70,255],[40,170,90,255],[220,180,30,255]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*4+1)+1+x*4,color=colors[(y>=450?2:0)+(x>=600?1:0)];for(let c=0;c<4;c++)rows[at+c]=color[c];}
  const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0'+MARKER)),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
  assert.ok(bytes.length<100*1024);
  return {bytes,manifest:{name:'synthetic-newsroom-1200x900.png',type:'image/png',size:bytes.length,sha256:hash(bytes),width,height,metadataMarker:MARKER,samples:[{x:100,y:100,rgba:colors[0]},{x:1100,y:100,rgba:colors[1]},{x:100,y:800,rgba:colors[2]},{x:1100,y:800,rgba:colors[3]}]}};
}
export function approvedOrigin(value) {
  const url=new URL(value);
  assert.equal(url.protocol,'https:');assert.equal(url.origin,value);assert.equal(url.username,'');assert.equal(url.password,'');
  assert.ok(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/u.test(url.hostname));assert.equal(url.port,'');
  return url.origin;
}
export function publicRoute(method,path) {
  if(method==='GET'&&['/','/fixture','/login','/fixture.js','/favicon.ico','/newsroom-remembered.html','/newsroom-remembered.js','/newsroom-remembered.css','/api/me','/api/newsroom-session/status','/api/newsroom-session/drafts'].includes(path))return true;
  if(method==='POST'&&['/api/login','/api/logout','/api/me/newsroom-session','/api/newsroom-session/logout','/api/newsroom-session/logout-all','/api/newsroom-session/drafts','/api/newsroom-session/media'].includes(path))return true;
  if(method==='GET'&&/^\/api\/newsroom-session\/drafts\/[A-Za-z0-9-]{8,64}$/u.test(path))return true;
  if(method==='GET'&&/^\/api\/newsroom-session\/media\/[A-Za-z0-9_-]{1,100}$/u.test(path))return true;
  if(method==='POST'&&/^\/api\/newsroom-session\/media\/[A-Za-z0-9_-]{1,100}\/finalize$/u.test(path))return true;
  if(method==='PUT'&&path.startsWith('/fixture-storage/'))return true;
  if(['GET','HEAD'].includes(method)&&path.startsWith('/fixture-media/'))return true;
  return false;
}
export const headersObject = value => Object.fromEntries([...new Headers(value).entries()].map(([key,val])=>[key,String(val).trim().replace(/\s+/gu,' ')]));
export function signedCapability({url,method,headers,origin,env,presignS3Request,maxTtl,now=Date.now()}) {
  const target=new URL(url);assert.equal(target.origin,origin);assert.equal(target.hash,'');
  const names=[...target.searchParams.keys()],allowed=['X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Expires','X-Amz-SignedHeaders','X-Amz-Signature'];
  assert.equal(names.length,allowed.length);assert.equal(new Set(names).size,names.length);assert.ok(names.every(name=>allowed.includes(name)));
  const stamp=target.searchParams.get('X-Amz-Date');assert.ok(/^\d{8}T\d{6}Z$/u.test(stamp));
  const date=new Date(stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8)+'T'+stamp.slice(9,11)+':'+stamp.slice(11,13)+':'+stamp.slice(13,15)+'Z');
  const ttl=Number(target.searchParams.get('X-Amz-Expires'));assert.ok(Number.isInteger(ttl)&&ttl>0&&ttl<=maxTtl);assert.ok(date.getTime()<=now+1000&&date.getTime()+ttl*1000>now);
  const unsigned=target.origin+target.pathname;
  const expected=presignS3Request({method,url:unsigned,headers,region:env.MEDIA_REGION,accessKeyId:env.MEDIA_ACCESS_KEY_ID,secretAccessKey:env.MEDIA_SECRET_ACCESS_KEY,expiresIn:ttl,now:date});
  assert.equal(url,expected,'Storage capability must exactly match actual signer output');
  return {expiresAt:date.getTime()+ttl*1000,path:target.pathname};
}
