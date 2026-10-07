import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseSnapshot } from '../src/github/parse.ts';
import { CACHE_KEY } from '../src/ui/cache.ts';

const raw: unknown = JSON.parse(
  await readFile(new URL('../public/snapshot.json', import.meta.url), 'utf8'),
);
const snapshot = parseSnapshot(raw);

test('refreshes all public records and persists the updated data', async ({
  page,
}) => {
  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(
      /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/,
    );
    if (match) {
      const item = snapshot.contributions.find(
        (entry) =>
          entry.ref.owner === match[1] &&
          entry.ref.repo === match[2] &&
          entry.ref.number === Number(match[3]),
      );
      if (!item?.pull.data) throw new Error('Missing public fixture');
      const pull = item.pull.data;
      await route.fulfill({
        json: {
          title: 'Updated: ' + pull.title,
          html_url: pull.url,
          user: { login: pull.author },
          state:
            pull.state.kind === 'merged' || pull.state.kind === 'closed'
              ? 'closed'
              : 'open',
          draft: pull.state.kind === 'draft',
          merged_at: pull.state.kind === 'merged' ? pull.state.mergedAt : null,
          head: { sha: pull.headSha },
          updated_at: pull.updatedAt,
        },
      });
    } else if (url.pathname.endsWith('/reviews'))
      await route.fulfill({ json: [] });
    else if (url.pathname.endsWith('/check-runs'))
      await route.fulfill({ json: { check_runs: [] } });
    else if (url.pathname.endsWith('/status'))
      await route.fulfill({ json: { statuses: [] } });
    else if (url.pathname.endsWith('/actions/runs'))
      await route.fulfill({ json: { workflow_runs: [] } });
    else throw new Error('Unexpected API request');
  });
  await page.goto('/');
  await page.getByRole('button', { name: /GitHubから更新/ }).click();
  await expect(page.getByRole('status')).toContainText(
    'すべてのPRをGitHubから取得しました',
  );
  await expect(
    page.locator('tr[data-id="axios/axios#11294"] .pr-title'),
  ).toContainText('Updated:');
  await page.reload();
  await expect(
    page.locator('tr[data-id="axios/axios#11294"] .pr-title'),
  ).toContainText('Updated:');
});

test.beforeEach(async ({ page }) => {
  await page.route('**/snapshot.json', (route) =>
    route.fulfill({ json: snapshot }),
  );
});

test('shows the accepted Axios contribution and human approval separately', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'OSSへの貢献',
  );
  const row = page.locator('tr[data-id="axios/axios#11294"]');
  await expect(row).toContainText('マージ済み');
  await expect(row).toContainText('人の承認あり');
  await expect(row).toContainText('成功');
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
});

test('combines search, language and status filters, including empty results', async ({
  page,
}) => {
  await page.goto('/');
  const search = page.getByLabel('リポジトリ・PRを検索');
  await search.fill('supabase');
  await expect(page.locator('.contribution-row')).toHaveCount(1);
  await search.fill('no-such-contribution');
  await expect(
    page.getByText('条件に一致するPRはありません。', { exact: false }),
  ).toBeVisible();
  await search.fill('');
  await page.getByLabel('言語で絞り込む').selectOption('TypeScript');
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.filter((item) => item.ref.language === 'TypeScript')
      .length,
  );
  await page.getByLabel('言語で絞り込む').selectOption('all');
  await page.getByRole('button', { name: /^マージ済み/ }).click();
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.filter(
      (item) => item.pull.data?.state.kind === 'merged',
    ).length,
  );
});

test('keeps data and exposes partial failure without sending a browser token', async ({
  page,
}) => {
  const authHeaders: (string | undefined)[] = [];
  await page.route('https://api.github.com/**', async (route) => {
    authHeaders.push(route.request().headers()['authorization']);
    await route.fulfill({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      json: {},
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /GitHubから更新/ }).click();
  await expect(page.getByRole('status')).toContainText(
    '一部の情報を取得できませんでした',
  );
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
  await expect(page.locator('tr[data-id="axios/axios#11294"]')).toContainText(
    '一部未取得',
  );
  expect(authHeaders).toEqual([undefined]);
});

test('renders a snapshot validation error with a retry action', async ({
  page,
}) => {
  await page.route('**/snapshot.json', (route) =>
    route.fulfill({ json: { version: 999 } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '記録を読み込めませんでした' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
});

test('ignores corrupt local storage', async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{invalid'),
    CACHE_KEY,
  );
  await page.goto('/');
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
});

test('works when localStorage is blocked', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage blocked');
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
});

test('uses the verified cache when loading the published snapshot fails', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
    { key: CACHE_KEY, data: snapshot },
  );
  await page.route('**/snapshot.json', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText(
    'このブラウザに保存した記録',
  );
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
});

test('renders API titles as text instead of executing HTML', async ({
  page,
}) => {
  const changed = {
    ...snapshot,
    contributions: snapshot.contributions.map((item, index) =>
      index === 0 && item.pull.data
        ? {
            ...item,
            pull: {
              ...item.pull,
              data: {
                ...item.pull.data,
                title: '<img src=x onerror=alert(1)>',
              },
            },
          }
        : item,
    ),
  };
  await page.route('**/snapshot.json', (route) =>
    route.fulfill({ json: changed }),
  );
  await page.goto('/');
  await expect(page.locator('tr[data-id="axios/axios#11294"]')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.locator('img')).toHaveCount(0);
});

test('fits the viewport and exposes contribution details', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.contribution-row')).toHaveCount(
    snapshot.contributions.length,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel('axios/axios #11294 の詳細', { exact: true }).click();
  await expect(
    page.locator('tr[data-id="axios/axios#11294"] .details-panel'),
  ).toContainText('取得した記録');
});
