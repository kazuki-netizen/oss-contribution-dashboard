import { describe, expect, it } from 'vitest';
import {
  parsePull,
  parseReview,
  parseSnapshot,
  safeUrl,
  timestamp,
  ValidationError,
} from '../src/github/parse.ts';
import {
  contribution,
  HEAD,
  NOW,
  ok,
  rawPull,
  rawReview,
  snapshot,
} from './fixtures.ts';

describe('runtime API validation', () => {
  it('rejects dates that JavaScript would silently normalize', () => {
    expect(() => timestamp('2026-02-30T00:00:00Z', 'date')).toThrow(
      ValidationError,
    );
  });
  it('rejects a review account type it cannot classify', () => {
    expect(() =>
      parseReview({
        ...rawReview('APPROVED'),
        user: { login: 'unknown', type: 'FutureBot' },
      }),
    ).toThrow(ValidationError);
  });
  it('reconstructs a typed open PR', () =>
    expect(parsePull(rawPull).state).toEqual({ kind: 'open' }));
  it('gives merged_at precedence over draft', () =>
    expect(
      parsePull({ ...rawPull, state: 'closed', draft: true, merged_at: NOW })
        .state,
    ).toEqual({ kind: 'merged', mergedAt: NOW }));
  it('rejects structurally invalid responses', () =>
    expect(() => parsePull({ ...rawPull, draft: 'false' })).toThrow(
      ValidationError,
    ));
  it('rejects unsafe link protocols', () =>
    expect(() => safeUrl('javascript:alert(1)', 'url')).toThrow(
      ValidationError,
    ));
  it('rejects URLs containing credentials', () =>
    expect(() => safeUrl('https://token@github.com/path', 'url')).toThrow(
      ValidationError,
    ));
  it('rejects a pull request URL hosted elsewhere', () =>
    expect(() =>
      parsePull({ ...rawPull, html_url: 'https://example.org/pull/1' }),
    ).toThrow(ValidationError));
  it('recognizes a review service using a User account', () =>
    expect(parseReview(rawReview('APPROVED', 'cubic-dev-ai'))?.isBot).toBe(
      true,
    ));
  it('recognizes GitHub Bot accounts', () =>
    expect(
      parseReview({
        ...rawReview('APPROVED', 'service'),
        user: { login: 'service', type: 'Bot' },
      })?.isBot,
    ).toBe(true));
  it('ignores unsubmitted and deleted-user reviews', () => {
    expect(parseReview(rawReview('PENDING'))).toBeNull();
    expect(parseReview({ ...rawReview('APPROVED'), user: null })).toBeNull();
  });
});

describe('persisted snapshot validation', () => {
  it('round-trips a complete snapshot', () =>
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot())))).toEqual(
      snapshot(),
    ));
  it('rejects a snapshot version it cannot understand', () =>
    expect(() => parseSnapshot({ ...snapshot(), version: 2 })).toThrow(
      ValidationError,
    ));
  it('rejects duplicate references', () =>
    expect(() =>
      parseSnapshot(snapshot([contribution(), contribution()])),
    ).toThrow(ValidationError));
  it('rejects a different author', () =>
    expect(() =>
      parseSnapshot(
        snapshot([
          contribution({
            pull: ok({ ...parsePull(rawPull), author: 'someone-else' }),
          }),
        ]),
      ),
    ).toThrow(ValidationError));
  it('rejects a PR URL that does not match its reference', () =>
    expect(() =>
      parseSnapshot(
        snapshot([
          contribution({
            pull: ok({
              ...parsePull(rawPull),
              url: 'https://github.com/axios/axios/pull/7',
            }),
          }),
        ]),
      ),
    ).toThrow(ValidationError));
  it('rejects successful CI records for a different commit', () =>
    expect(() =>
      parseSnapshot(
        snapshot([
          contribution({
            checks: ok([
              {
                key: 'check:old',
                name: 'Old tests',
                status: 'completed',
                conclusion: 'success',
                headSha: HEAD.replace(/a/g, 'b'),
                url: null,
              },
            ]),
          }),
        ]),
      ),
    ).toThrow(ValidationError));
});
