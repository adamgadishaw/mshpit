import { api } from '../../lib/api';

// Imported only by the lazy Artist HQ cleanup panel, not the shared composer.
export function withdrawPrivateCalendar({ body, accountId, signal }) {
  return api('/api/posts', { method: 'POST', body, expectedAccountId: accountId, signal, silent: true, context: 'Withdrawing your private scheduled show' });
}

export function removeUnusedCalendarUpload({ assetId, accountId, signal }) {
  return api(`/api/media/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE', expectedAccountId: accountId, signal, silent: true, context: 'Removing an unused scheduled-show upload' });
}
