import type { PullState, Remote } from '../src/domain/types.ts';

// This file is checked by tsc: removing the protections makes @ts-expect-error fail.
// @ts-expect-error A merged PR must include the verified merge timestamp.
const missingMergeDate: PullState = { kind: 'merged' };
const wrongPayload: Remote<number> = {
  status: 'ok',
  // @ts-expect-error A successful generic Remote<number> cannot contain a string.
  data: '1',
  fetchedAt: '2026-10-07T00:00:00Z',
};
// @ts-expect-error An unavailable source must retain its error message.
const missingError: Remote<number> = {
  status: 'error',
  data: null,
  fetchedAt: null,
};
void [missingMergeDate, wrongPayload, missingError];
