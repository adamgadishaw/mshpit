import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
if (resolve(process.cwd()) !== appRoot) throw new Error('Mobile smoke must run from its own checkout');
const keep = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']);
for (const key of Object.keys(process.env)) if (!keep.has(key.toUpperCase())) delete process.env[key];
mkdirSync(join(appRoot, '.tmp'), { recursive: true });
process.env.PIT_DATA_DIR = mkdtempSync(join(appRoot, '.tmp', 'mobile-data-'));
process.env.NODE_ENV = 'test';
process.env.PIT_ENV = 'staging';
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = 'true';
process.env.PORT = '3000';

const denied = () => { throw new Error('LOCAL_MOBILE_SMOKE_OUTBOUND_BLOCKED'); };
globalThis.fetch = async () => denied();
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
net.connect = denied;
net.createConnection = denied;
tls.connect = denied;
net.Socket.prototype.connect = denied;
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] !== 'number') throw new Error('Unexpected mobile smoke listen shape');
  if (args[0] !== 3000) throw new Error('Unexpected mobile smoke port');
  return listen.call(this, { port: 3000, host: '127.0.0.1' }, ...args.slice(1));
};
syncBuiltinESMExports();
console.log('Disposable mobile backend: localhost:3000; outbound requests disabled; no service credentials inherited.');
