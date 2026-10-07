import { CONTRIBUTIONS, USERNAME, contributionId } from '../config.ts';
import type { Snapshot } from '../domain/types.ts';
import { parseSnapshot } from '../github/parse.ts';

export const CACHE_KEY = 'oss-contribution-dashboard:v1';

export function readCache(storage: Pick<Storage, 'getItem'>): Snapshot | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    const snapshot = parseSnapshot(value);
    if (snapshot.username !== USERNAME) return null;
    const expected = CONTRIBUTIONS.map(contributionId).sort();
    const actual = snapshot.contributions
      .map((entry) => contributionId(entry.ref))
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function writeCache(
  storage: Pick<Storage, 'setItem'>,
  snapshot: Snapshot,
): void {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Privacy settings and quota limits must not prevent rendering. */
  }
}
