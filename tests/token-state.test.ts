import { expect, it } from 'vitest';
import { tokenTransition } from '../src/auth/state';

it('stops remote writes after invalid_grant while retaining the folder pointer', () => {
  expect(tokenTransition({ state: 'connected', folderId: 'drive-folder' }, { type: 'invalid-grant' })).toEqual({ state: 'disconnected', folderId: 'drive-folder', reason: 'invalid_grant' });
});
