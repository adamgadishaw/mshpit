import { Component, createElement as h } from 'react';
import { freshAppUrl, requestWebRecovery } from './webRecovery.mjs';

// A DOM-only view, rendered exclusively by the web import/boundary paths.
// Keep it in the existing tree so a failed optional screen cannot unmount drafts.
export default class WebChunkRecovery extends Component {
  state = { message: '' };
  recover = () => this.setState(requestWebRecovery({ reload: this.props.reload, unmounted: this.props.unmounted }));
  render() {
    const button = { minHeight: 44, padding: '10px 20px', borderRadius: 22, font: 'inherit', cursor: 'pointer' };
    return h('section', { role: 'alert', 'aria-live': 'polite', 'data-testid': 'chunk-recovery',
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 28, color: '#F4EFE7', background: '#09090B', textAlign: 'center', fontFamily: 'system-ui, sans-serif' } },
      h('h2', { style: { margin: 0 } }, 'This screen needs a fresh start'),
      h('p', { style: { maxWidth: 460, lineHeight: 1.5 } }, this.props.unmounted
        ? 'This screen stopped before its forms could be saved. Only drafts already saved on this device can be restored. Unsaved edits or selected files may be lost on reload.'
        : 'A screen could not load. Keep this tab open while we check supported drafts before a reload. Other unsaved forms or selected files may not be recoverable.'),
      h('button', { type: 'button', style: button, onClick: this.recover, 'data-testid': 'recovery-save-reload' }, this.props.unmounted ? 'Reload with warning' : 'Save drafts and reload'),
      h('a', { href: freshAppUrl(), target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'recovery-open-tab', style: { color: '#FF8C42', padding: 12 } }, 'Open Mshpit in a new tab'),
      h('button', { type: 'button', style: button, 'data-testid': 'recovery-stay', onClick: () => this.setState({ message: 'This tab is staying open. You can continue in a new tab without closing this one.' }) }, 'Keep this tab'),
      this.props.reference ? h('p', { 'data-testid': 'recovery-reference', style: { fontFamily: 'monospace', fontSize: 12 } }, this.props.reference) : null,
      this.state.message ? h('p', { role: 'status', 'data-testid': 'recovery-status', style: { maxWidth: 460 } }, this.state.message) : null);
  }
}
