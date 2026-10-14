// Platform implementation of the existing theme entry, not a second design system.
export * from './theme.js';
import { colors as shared } from './theme.js';
export const colors = Object.freeze({ ...shared,
  bg: '#FFFFFF', bgElev: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F3F5F6',
  line: '#D7DCE0', lineSoft: '#E6EAED', text: '#141719', textDim: '#606970', textFaint: '#687279',
  amber: '#477A06', amberStrong: '#B6F23A', accentEdge: '#477A06',
  gold: '#65727C', magenta: '#65727C', cool: '#65727C', good: '#477A06', danger: '#B42332',
});
export const themeIsDark = false;
export const radius = { sm: 8, md: 10, lg: 12, pill: 999 };
export const shadow = { card: {}, control: {}, sheet: {} };
export const roleColor = role => role === 'admin' ? colors.magenta : role === 'moderator' ? colors.good : role === 'artist' ? colors.amber : null;

