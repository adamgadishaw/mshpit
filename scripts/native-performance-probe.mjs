import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const adb = process.env.ANDROID_HOME ? process.env.ANDROID_HOME + '/platform-tools/adb.exe' : 'adb';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const watchdog=setTimeout(()=>{console.error('Native performance probe timed out');process.exit(1);},30000);
const pages=await fetch('http://127.0.0.1:8081/json/list').then(r=>r.json());
const page=pages.find(p=>p.appId==='com.mshpit.app.dev');
if(!page) throw new Error('No local development app inspector');
const ws=new WebSocket(page.webSocketDebuggerUrl, { origin: 'http://127.0.0.1:8081' });
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let sequence=0; const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}};
async function evaluate(expression){const id=++sequence;const response=new Promise(resolve=>pending.set(id,resolve));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));const result=await response;if(result.result?.exceptionDetails)throw new Error(JSON.stringify(result));return result.result?.result?.value;}
const [mode,...args]=process.argv.slice(2);
try{
 if(mode==='eval') console.log(JSON.stringify(await evaluate(args.join(' ')),null,2));
 if(mode==='tap') {
   if (!await evaluate('!!globalThis.__MSHPIT_NATIVE_PERF__')) throw new Error('Start Metro with EXPO_PUBLIC_NATIVE_PERF=1 and reload the native app before measuring.');
   const [label,x,y]=args;
   await evaluate(`globalThis.__MSHPIT_NATIVE_PERF__.pending={label:${JSON.stringify(label)},at:performance.now()};true`);
   execFileSync(adb,['-s','emulator-5554','shell','input','tap',x,y]);
   for(let i=0;i<60;i++){await delay(100);const result=await evaluate(`globalThis.__MSHPIT_NATIVE_PERF__.screens.findLast(x=>x.label===${JSON.stringify(label)})`);if(result){console.log(JSON.stringify(result));break;}if(i===59)console.log('No screen mount within 6 seconds');}
 }
 if(mode==='save') writeFileSync(args[0],JSON.stringify(await evaluate('globalThis.__MSHPIT_NATIVE_PERF__'),null,2));
}finally{clearTimeout(watchdog);ws.close();}
