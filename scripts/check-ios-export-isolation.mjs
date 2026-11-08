// Offline source-map evidence only. This does not build or modify export artifacts.
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 100;
const confinedDomains = new Set(['iosMessageDrafts.mjs', 'iosFeedReturn.mjs', 'iosSearchAnnouncements.mjs', 'sessionValidationStatus.mjs']);
// Validate retained defaults, without requiring tree-shaken modules to survive.
const inertDefaults = new Map([
  ['src/hooks/sessionValidationStatus.js', 'export const sessionValidationStatusForOwner = () => null;'],
  ['src/components/SessionValidationPending.jsx', 'export default function SessionValidationPending({ fallback }) { return fallback; }'],
  ['src/domain/messageDraftOwner.js', 'export const createIOSMessageDrafts = () => null;'],
  ['src/hooks/useIOSFeedReturn.js', 'export default function useIOSFeedReturn() { return null; } export function FeedReturnProvider({ children }) { return children; }'],
  ['src/hooks/useIOSSearchAnnouncement.js', 'const noop = () => {}; const silent = Object.freeze({ isCurrent: () => true, request: noop, update: noop }); export default function useIOSSearchAnnouncement() { return silent; }'],
]);
const compact = (value) => value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '').replace(/\s+/g, '');
const label = (value) => basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160);

function sourcePath(value) {
  let result = value.replaceAll('\\', '/');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(result)) {
    try { result = new URL(result).pathname; } catch { throw new Error('invalid source URL'); }
  }
  try { result = decodeURIComponent(result); } catch { throw new Error('invalid source encoding'); }
  return result.replaceAll('\\', '/').split(/[?#]/, 1)[0];
}

export function normalizedSource(source, sourceRoot = '') {
  const value = sourcePath(source);
  const rooted = /^(?:[a-z]:\/|\/)/i.test(value) || /^[a-z][a-z\d+.-]*:/i.test(source);
  return posix.normalize(rooted ? value : posix.join(sourcePath(sourceRoot), value));
}

function appSource(source) {
  // Native/vendor implementations are not application platform choices.
  if (/(^|\/)(node_modules|Pods)(\/|$)/.test(source)) return null;
  const match = source.match(/(?:^|\/)(src\/.*)$/);
  if (match) return match[1];
  if (/\.ios\.[^/]+$/.test(source) || confinedDomains.has(posix.basename(source))) return posix.basename(source);
  if (/(^|\/)(App\.[^/]+|index\.[cm]?jsx?)$/.test(source)) return basename(source);
  return null;
}

function readMap(path) {
  if (!lstatSync(path).isFile()) throw new Error('map must be a regular file');
  let map;
  try { map = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('map is not valid JSON'); }
  if (!map || map.version !== 3 || !Array.isArray(map.sources) || !map.sources.length
    || map.sources.some((s) => typeof s !== 'string' || !s.trim())
    || typeof map.mappings !== 'string' || !/[A-Za-z0-9+/]/.test(map.mappings)
    || !/^[A-Za-z0-9+/;,]+$/.test(map.mappings)
    || !Array.isArray(map.names) || map.names.some((n) => typeof n !== 'string')
    || (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string')
    || map.sections !== undefined
    || (map.sourcesContent !== undefined && (!Array.isArray(map.sourcesContent)
      || map.sourcesContent.length !== map.sources.length
      || map.sourcesContent.some((s) => s !== null && typeof s !== 'string')))) {
    throw new Error('expected a nonempty flat v3 source map with sources, names and mappings');
  }
  return map;
}

function webMaps(input) {
  const stat = lstatSync(input);
  if (stat.isFile()) return [input];
  if (!stat.isDirectory()) throw new Error('web input must be a regular map or export directory');
  let root = input;
  for (const segment of ['_expo', 'static', 'js', 'web']) {
    root = join(root, segment);
    if (!lstatSync(root).isDirectory()) throw new Error('Metro web path must contain regular directories, not symlinks');
  }
  const maps = [];
  let chunks = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('symlinks are not supported in the Metro web export');
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.js')) {
        chunks++;
        if (!lstatSync(`${path}.map`).isFile()) throw new Error('Metro web chunk lacks an external map');
      } else if (entry.name.endsWith('.map')) maps.push(path);
    }
  }
  visit(root);
  if (!chunks || !maps.length) throw new Error('Metro web export has no JavaScript chunks/maps');
  return maps;
}

export function checkIsolation({ androidMap, web }) {
  const report = { schemaVersion: 1, passed: true, scope: 'export-source-isolation', platforms: [], issueCount: 0, issues: [] };
  function issue(platform, map, reason, source) {
    report.passed = false;
    report.issueCount++;
    if (report.issues.length < LIMIT) report.issues.push({ platform, map: label(map), reason, ...(source ? { source: source.slice(0, 240) } : {}) });
  }
  for (const [platform, input] of [['android', androidMap], ['web', web]]) {
    const summary = { platform, maps: 0, sources: 0, appSources: 0, retainedDefaults: [] };
    report.platforms.push(summary);
    let paths;
    try {
      if (typeof input !== 'string' || !input) throw new Error('input is required');
      paths = platform === 'web' ? webMaps(input) : [input];
    } catch (error) {
      issue(platform, input || platform, error.code ? `input unavailable (${error.code})` : error.message);
      continue;
    }
    const defaults = new Set();
    for (const path of paths) {
      try {
        const map = readMap(path);
        summary.maps++;
        summary.sources += map.sources.length;
        for (let i = 0; i < map.sources.length; i++) {
          const source = appSource(normalizedSource(map.sources[i], map.sourceRoot));
          if (!source) continue;
          summary.appSources++;
          if (/\.ios\.[^/]+$/.test(source)) issue(platform, path, 'app iOS implementation leaked', source);
          if (confinedDomains.has(posix.basename(source))) issue(platform, path, 'iOS-confined domain leaked', source);
          if (inertDefaults.has(source)) {
            const content = map.sourcesContent?.[i];
            if (typeof content !== 'string' || compact(content) !== compact(inertDefaults.get(source))) {
              issue(platform, path, 'retained default is missing source content or differs from inert contract', source);
            } else defaults.add(source);
          }
        }
      } catch (error) {
        issue(platform, path, error.code ? `map unavailable (${error.code})` : error.message);
      }
    }
    summary.retainedDefaults = [...defaults].sort();
    if (!summary.appSources) issue(platform, input, 'no app sources found; cannot establish isolation');
  }
  report.omittedIssues = report.issueCount - report.issues.length;
  return report;
}

export function run(args = process.argv.slice(2)) {
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--android-map', '--web', '--report'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) {
        throw new Error('usage: node scripts/check-ios-export-isolation.mjs --android-map MAP --web EXPORT_DIR_OR_MAP [--report NEW_JSON_PATH]');
      }
      options[args[i]] = args[i + 1];
    }
    if (!options['--android-map'] || !options['--web']) throw new Error('--android-map and --web are required');
    const report = checkIsolation({ androidMap: options['--android-map'], web: options['--web'] });
    if (options['--report']) {
      const output = resolve(realpathSync(dirname(resolve(options['--report']))), basename(options['--report']));
      // Never create a report inside an input artifact directory, or overwrite any file.
      for (const input of [options['--android-map'], options['--web']]) {
        let root;
        try { const actual = realpathSync(input); root = lstatSync(actual).isDirectory() ? actual : dirname(actual); } catch { continue; }
        const fromRoot = relative(root, output);
        if (!fromRoot || (!fromRoot.startsWith(`..${posix.sep}`) && fromRoot !== '..' && !fromRoot.startsWith('/'))) {
          throw new Error('report must be outside input artifact directories');
        }
      }
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    }
    console.log(JSON.stringify(report, null, 2));
    return report.passed ? 0 : 1;
  } catch (error) {
    console.error(`[ios-export-isolation] ${error.code ? `file operation failed (${error.code})` : error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
