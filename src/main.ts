import './style.css';
import { CONTRIBUTIONS, USERNAME } from './config.ts';
import type { Snapshot } from './domain/types.ts';
import { hasErrors } from './domain/summarize.ts';
import { GitHubClient, loadSnapshot } from './github/client.ts';
import { parseSnapshot } from './github/parse.ts';
import { readCache, writeCache } from './ui/cache.ts';
import { mountDashboard } from './ui/dashboard.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const appRoot: HTMLElement = root;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
async function start(): Promise<void> {
  appRoot.textContent = '公開された貢献記録を読み込んでいます…';
  const store = storage();
  const cached = store ? readCache(store) : null;
  let current: Snapshot;
  let offline = false;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}snapshot.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Snapshot request failed');
    const value: unknown = await response.json();
    const published = parseSnapshot(value);
    if (published.username !== USERNAME)
      throw new Error('Unexpected snapshot author');
    current =
      cached && cached.capturedAt > published.capturedAt ? cached : published;
  } catch {
    if (!cached) {
      appRoot.replaceChildren();
      const error = document.createElement('div');
      error.className = 'fatal-error';
      const title = document.createElement('h1');
      title.textContent = '記録を読み込めませんでした';
      const description = document.createElement('p');
      description.textContent =
        '通信または公開データの形式を確認できませんでした。再読み込みするか、GitHubの公開記録をご確認ください。';
      const retry = document.createElement('button');
      retry.textContent = '再読み込み';
      retry.addEventListener('click', () => {
        void start();
      });
      const github = document.createElement('a');
      github.href = `https://github.com/${USERNAME}`;
      github.textContent = 'GitHubの公開記録を見る';
      error.append(title, description, retry, github);
      appRoot.append(error);
      return;
    }
    current = cached;
    offline = true;
  }
  if (store) writeCache(store, current);
  let busy = false;
  let lastRefresh = 0;
  const controller = mountDashboard(appRoot, current, () => {
    void refresh();
  });
  if (offline)
    controller.notify(
      '通信に失敗したため、このブラウザに保存した記録を表示しています。取得時刻をご確認ください。',
      true,
    );
  async function refresh(): Promise<void> {
    if (busy) return;
    if (Date.now() - lastRefresh < 60_000) {
      controller.notify(
        '連続した取得を避けるため、前の更新から1分後に再試行してください。',
        true,
      );
      return;
    }
    busy = true;
    lastRefresh = Date.now();
    controller.setBusy(true);
    controller.notify(
      'GitHubの公開APIから取得しています。失敗した項目は、取得できた記録と区別して表示します。',
    );
    try {
      const next = parseSnapshot(
        await loadSnapshot(
          new GitHubClient(),
          USERNAME,
          CONTRIBUTIONS,
          current,
          controller.progress,
        ),
      );
      current = next;
      if (store) writeCache(store, current);
      controller.update(current);
      if (!current.contributions.some(hasErrors))
        controller.notify('すべてのPRをGitHubから取得しました。');
    } catch {
      controller.notify(
        '更新を完了できませんでした。前回取得した記録を表示しています。',
        true,
      );
    } finally {
      busy = false;
      controller.setBusy(false);
    }
  }
}
void start();
