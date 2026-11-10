import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from '@babel/core';

// Execute the selected JSX with controlled hooks/host components. This checks
// the screen contract on Node; it is not UIKit layout or device validation.
const require = createRequire(import.meta.url);
const code = transformSync(readFileSync(new URL('./CityScreen.jsx', import.meta.url), 'utf8'), {
  filename: 'CityScreen.jsx', babelrc: false, configFile: false,
  plugins: [[require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs')],
}).code;

function fixture() {
  const state = [], effects = [];
  let cursor = 0, changed = false, pending = [];
  const resource = { data: null, status: 'loading', error: null, reload() {}, refresh() {} };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: {
      useState(initial) {
        const slot = cursor++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], value => {
          const next = typeof value === 'function' ? value(state[slot]) : value;
          changed ||= !Object.is(next, state[slot]);
          state[slot] = next;
        }];
      },
      useEffect(callback, dependencies) {
        const slot = cursor++;
        if (!effects[slot] || dependencies.some((value, index) => !Object.is(value, effects[slot][index]))) {
          effects[slot] = dependencies;
          pending.push(callback);
        }
      },
      useCallback: fn => fn,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
      StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ width: 320 }),
    },
    '../theme': { colors: {}, radius: {}, shadow: {}, space: value => value * 4 },
    '../features/cities/useCityResource': () => resource,
    '../hooks/useScopedRefresh': () => ({ refresh() {}, refreshing: false }),
    '../domain/scopedRefresh.mjs': { refreshScope: (...parts) => parts.join(':') },
    '../components/cities/cityPresentation.mjs': { cityText: (_copy, key) => key },
    '../features/cities/cityApi.mjs': { readCityCopy() {}, readCityGuide() {} },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name in imports) return imports[name];
    if (name.startsWith('../components/') || name === './CityDirectoryScreen') return name.split('/').at(-1);
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return {
    resource,
    render(props) {
      let tree;
      for (let pass = 0; pass < 5; pass++) {
        cursor = 0; changed = false; pending = [];
        const screen = module.exports.default(props);
        tree = typeof screen.type === 'function' ? screen.type(screen.props) : screen;
        pending.forEach(effect => effect());
        if (!changed) return tree;
      }
      throw new Error('Screen did not settle');
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[].concat(tree.props?.children || []).flatMap(nodes)];
}
const dismiss = tree => nodes(tree).find(node => node.props?.accessibilityLabel === 'Dismiss city prompt');
const home = Object.freeze({ city: 'London', countryCode: 'CA', citySlug: 'london', homeShowPrompt: true });

test('native city prompt remains outside scroll content and is dismissible during loading or failure', () => {
  const f = fixture();
  let chosen = 0;
  const props = { city: home, accountId: 'a', onChooseCity: () => chosen++ };
  let tree = f.render(props);
  const [header, boundary, prompt] = tree.props.children;
  assert.equal(header.type, 'ScreenHeader');
  assert.equal(boundary.type, 'VinylRefreshBoundary');
  assert.equal(boundary.props.children.type, 'ScrollView');
  assert.equal(boundary.props.children.props.contentInsetAdjustmentBehavior, 'automatic');
  assert.ok(nodes(prompt).includes(dismiss(tree)));
  assert.equal(prompt.props.children[1].props.style.flexWrap, 'wrap');
  const choose = nodes(prompt).find(node => node.props?.title === 'Choose another city');
  choose.props.onPress();
  assert.equal(chosen, 1);
  f.resource.status = 'error'; f.resource.error = new Error('fixture failure');
  tree = f.render(props);
  assert.ok(dismiss(tree));
  const control = dismiss(tree);
  assert.equal(control.props.style({ focused: false })[0].minHeight, 44);
  control.props.onPress();
  assert.equal(dismiss(f.render(props)), undefined);
  assert.deepEqual(home, { city: 'London', countryCode: 'CA', citySlug: 'london', homeShowPrompt: true });
});

test('dismissal stays local to the account and full city identity, including same-name countries', () => {
  const f = fixture();
  const props = { city: home, accountId: 'a' };
  dismiss(f.render(props)).props.onPress();
  assert.equal(dismiss(f.render(props)), undefined);
  const otherCountry = { ...props, city: { ...home, countryCode: 'GB' } };
  assert.ok(dismiss(f.render(otherCountry)), 'another London must get its own home-city prompt');
  dismiss(f.render(otherCountry)).props.onPress();
  assert.equal(dismiss(f.render(otherCountry)), undefined);
  assert.ok(dismiss(f.render({ ...otherCountry, accountId: 'b' })));
});

test('ordinary city browsing and missing-home directory have no home-city prompt', () => {
  const f = fixture();
  assert.equal(dismiss(f.render({ city: { ...home, homeShowPrompt: false } })), undefined);
  assert.equal(f.render({ city: { directory: true } }).type, 'CityDirectoryScreen');
});
