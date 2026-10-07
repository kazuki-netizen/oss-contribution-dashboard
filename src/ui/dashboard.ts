import { REPOSITORY_URL, contributionId } from '../config.ts';
import {
  ciState,
  hasErrors,
  humanReviewState,
  statistics,
} from '../domain/summarize.ts';
import { assertNever } from '../domain/types.ts';
import type {
  CiState,
  Contribution,
  HumanReviewState,
  Language,
  PullState,
  Snapshot,
} from '../domain/types.ts';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function link(text: string, href: string, className = ''): HTMLAnchorElement {
  const node = element('a', className, text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
function date(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
function pill(label: string, kind: string): HTMLElement {
  return element('span', `pill pill--${kind}`, label);
}
function stateLabel(state: PullState): string {
  switch (state.kind) {
    case 'merged':
      return 'マージ済み';
    case 'open':
      return '公開中';
    case 'closed':
      return 'クローズ';
    case 'draft':
      return 'Draft';
    default:
      return assertNever(state);
  }
}
const REVIEW_LABELS: Record<HumanReviewState, string> = {
  approved: '人の承認あり',
  'changes-requested': '修正要求あり',
  commented: '人のコメントあり',
  waiting: '人のレビュー待ち',
  unavailable: 'レビュー取得できず',
};
const CI_LABELS: Record<CiState, string> = {
  passed: '成功',
  failed: '失敗 / 中止',
  'action-required': '実行許可待ち',
  running: '実行中 / 待機',
  'not-run': '実行記録なし',
  unavailable: '取得不完全',
};

type Filter = 'all' | PullState['kind'];

export interface DashboardController {
  update(snapshot: Snapshot): void;
  progress(completed: number, total: number): void;
  setBusy(busy: boolean): void;
  notify(message: string, warning?: boolean): void;
}

export function mountDashboard(
  root: HTMLElement,
  initial: Snapshot,
  onRefresh: () => void,
): DashboardController {
  let snapshot = initial;
  let filter: Filter = 'all';
  let language: Language | 'all' = 'all';
  let query = '';

  root.replaceChildren();
  const page = element('div', 'page');
  const header = element('header', 'header');
  const brand = element('a', 'brand');
  brand.href = '#main';
  brand.append(
    element('span', 'brand-mark', '↗'),
    element('span', '', 'OSS / CONTRIBUTIONS'),
  );
  const navigation = element('nav', 'header-nav');
  navigation.setAttribute('aria-label', '関連リンク');
  navigation.append(
    link('ソースコード ↗', REPOSITORY_URL, 'source-link'),
    link(
      '@' + snapshot.username,
      `https://github.com/${snapshot.username}`,
      'profile-link',
    ),
  );
  header.append(brand, navigation);

  const main = element('main');
  main.id = 'main';
  const hero = element('section', 'hero');
  const introduction = element('div', 'hero-copy');
  const eyebrow = element('div', 'eyebrow', 'KAZUKI MIYAZAKI / OPEN SOURCE');
  const title = element('h1');
  title.append(
    document.createTextNode('コードで残す、'),
    element('br'),
    element('span', 'title-accent', 'OSSへの貢献。'),
  );
  introduction.append(
    eyebrow,
    title,
    element(
      'p',
      'hero-description',
      '不具合の再現から、修正、テスト、ドキュメントまで。\n公開された記録から、貢献の状況を確かめる。',
    ),
  );
  const author = element('div', 'author');
  author.append(
    element('span', 'avatar', 'KM'),
    element('span', '', '宮﨑一旗'),
    element('span', 'author-handle', '@' + snapshot.username),
  );
  introduction.append(author);
  const featured = element('div', 'featured');
  featured.setAttribute('aria-label', '採用された貢献');
  hero.append(introduction, featured);

  const metrics = element('section', 'metrics');
  metrics.setAttribute('aria-label', '貢献の集計');
  const ledger = element('section', 'ledger');
  const sectionHeader = element('div', 'section-header');
  const headingGroup = element('div');
  headingGroup.append(
    element('span', 'eyebrow', 'THE CONTRIBUTION LOG'),
    element('h2', '', '貢献の記録'),
  );
  const updateGroup = element('div', 'update-group');
  const updated = element('span', 'updated');
  const refresh = element('button', 'refresh-button', '↻ GitHubから更新');
  refresh.type = 'button';
  refresh.addEventListener('click', onRefresh);
  updateGroup.append(updated, refresh);
  sectionHeader.append(headingGroup, updateGroup);

  const banner = element('div', 'banner');
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.hidden = true;
  const toolbar = element('div', 'toolbar');
  const filters = element('div', 'filters');
  filters.setAttribute('aria-label', 'PRの状態で絞り込む');
  const filterButtons = new Map<Filter, HTMLButtonElement>();
  const filterLabels: Record<Filter, string> = {
    all: 'すべて',
    merged: 'マージ済み',
    open: '公開中',
    draft: 'Draft',
    closed: 'クローズ',
  };
  for (const key of ['all', 'merged', 'open', 'draft', 'closed'] as const) {
    const button = element('button', 'filter-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      filter = key;
      renderRows();
    });
    filterButtons.set(key, button);
    filters.append(button);
  }
  const searchGroup = element('div', 'search-group');
  const languageLabel = element('label', 'sr-only', '言語で絞り込む');
  languageLabel.htmlFor = 'language-filter';
  const select = element('select', 'language-select');
  select.id = 'language-filter';
  for (const [value, label] of [
    ['all', 'すべての言語'],
    ['TypeScript', 'TypeScript'],
    ['JavaScript', 'JavaScript'],
    ['Python', 'Python'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const value = select.value;
    if (
      value === 'all' ||
      value === 'TypeScript' ||
      value === 'JavaScript' ||
      value === 'Python'
    ) {
      language = value;
      renderRows();
    }
  });
  const searchLabel = element('label', 'sr-only', 'リポジトリ・PRを検索');
  searchLabel.htmlFor = 'contribution-search';
  const search = element('input', 'search-input');
  search.id = 'contribution-search';
  search.type = 'search';
  search.placeholder = 'リポジトリ・PRを検索';
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderRows();
  });
  searchGroup.append(languageLabel, select, searchLabel, search);
  toolbar.append(filters, searchGroup);

  const table = element('table', 'contribution-table');
  const caption = element(
    'caption',
    'sr-only',
    '公開したPRの状態、人のレビュー、CIチェック',
  );
  const thead = element('thead');
  const headRow = element('tr');
  for (const label of [
    'PROJECT / PULL REQUEST',
    'STATUS / REVIEW',
    'CI / CHECKS',
    '',
  ]) {
    const th = element('th', '', label);
    th.scope = 'col';
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = element('tbody');
  table.append(caption, thead, tbody);
  const results = element('div', 'table-footnote');
  results.setAttribute('aria-live', 'polite');
  ledger.append(sectionHeader, banner, toolbar, table, results);

  const other = element('section', 'other-contributions');
  const otherIntro = element('div', 'other-intro');
  otherIntro.append(
    element('span', 'eyebrow', 'BEYOND PULL REQUESTS'),
    element('h2', '', 'レビューと不具合報告'),
  );
  const otherCards = element('div', 'other-cards');
  for (const entry of [
    {
      tag: 'REVIEW',
      title: '再現テスト付きのPRレビュー',
      body: 'Day.jsのcalendar処理を検証。コールバックのフォールバックで起きる例外を、実行できるテストとともに報告。',
      url: 'https://github.com/iamkun/dayjs/pull/3220#pullrequestreview-5410437825',
      id: 'Day.js / #3220',
    },
    {
      tag: 'BUG REPORT',
      title: '最小コードで不具合を報告',
      body: 'calendarのコールバックに渡される基準時刻を検証。公開版の再現コードと比較結果を添えてIssueを提出。',
      url: 'https://github.com/iamkun/dayjs/issues/3246',
      id: 'Day.js / #3246',
    },
  ]) {
    const card = element('article', 'other-card');
    card.append(
      element('span', 'mini-tag', entry.tag),
      element('h3', '', entry.title),
      element('p', '', entry.body),
      link(entry.id + ' ↗', entry.url),
    );
    otherCards.append(card);
  }
  other.append(otherIntro, otherCards);
  const footer = element('footer', 'footer');
  const footerCopy = element('div');
  footerCopy.append(
    element('strong', '', '公開記録を、そのまま。'),
    element('p', '', '人の承認と自動チェックは別々に表示。日時は日本時間。'),
  );
  footer.append(
    footerCopy,
    link(
      '設計・テスト・AI利用について ↗',
      REPOSITORY_URL + '#設計と検証',
      'footer-link',
    ),
  );
  main.append(hero, metrics, ledger, other);
  page.append(header, main, footer);
  root.append(page);

  function renderFeatured(): void {
    featured.replaceChildren();
    const merged = snapshot.contributions
      .filter((item) => item.pull.data?.state.kind === 'merged')
      .sort((a, b) => {
        const first = a.pull.data?.state;
        const second = b.pull.data?.state;
        return first?.kind === 'merged' && second?.kind === 'merged'
          ? second.mergedAt.localeCompare(first.mergedAt)
          : 0;
      })[0];
    featured.append(
      element(
        'div',
        'featured-top',
        merged ? 'MERGED CONTRIBUTION' : 'CONTRIBUTION IN PROGRESS',
      ),
      element('div', 'featured-decoration', '↗'),
    );
    if (merged?.pull.data?.state.kind === 'merged') {
      const pull = merged.pull.data;
      const state = pull.state;
      if (state.kind !== 'merged') return;
      featured.append(
        pill('マージ済み', 'merged'),
        element(
          'h2',
          'featured-repo',
          `${merged.ref.owner} / ${merged.ref.repo}`,
        ),
        element('p', 'featured-title', pull.title),
        element('p', 'featured-focus', merged.ref.focus),
      );
      const bottom = element('div', 'featured-bottom');
      bottom.append(
        element('span', '', `${date(state.mergedAt)} 採用`),
        link(`#${merged.ref.number} 記録を見る ↗`, pull.url),
      );
      featured.append(bottom);
    } else
      featured.append(
        element('h2', 'featured-repo', '次の採用に向けて。'),
        element(
          'p',
          'featured-focus',
          '公開されたPRとレビューの状況を、下の一覧で確認できます。',
        ),
      );
  }
  function renderMetrics(): void {
    metrics.replaceChildren();
    const stats = statistics(snapshot);
    const entries = [
      ['TRACKED PRS', '提出したPR', stats.total],
      ['MERGED', 'マージ済み', stats.merged],
      ['TYPESCRIPT', 'TypeScriptのPR', stats.typescript],
      ['PROJECTS', '参加プロジェクト', stats.projects],
    ] as const;
    for (const [label, name, value] of entries) {
      const card = element('div', 'metric');
      const line = element('div', 'metric-top');
      line.append(
        element('span', '', label),
        element('span', 'metric-symbol', label === 'MERGED' ? '✓' : '↗'),
      );
      card.append(
        line,
        element('div', 'metric-value', value.toString().padStart(2, '0')),
        element('div', 'metric-name', name),
      );
      metrics.append(card);
    }
  }
  function rowFor(item: Contribution): HTMLTableRowElement {
    const row = element('tr', 'contribution-row');
    row.dataset['id'] = contributionId(item.ref);
    const projectCell = element('td', 'project-cell');
    const badge = element(
      'span',
      `project-icon project-icon--${item.ref.language.toLowerCase()}`,
      item.ref.repo === 'core' ? 'V' : item.ref.repo.slice(0, 1).toUpperCase(),
    );
    const projectCopy = element('div', 'project-copy');
    const projectLine = element('div', 'project-line');
    const href =
      item.pull.data?.url ??
      `https://github.com/${item.ref.owner}/${item.ref.repo}/pull/${item.ref.number}`;
    projectLine.append(
      link(`${item.ref.owner}/${item.ref.repo}`, href, 'repository-name'),
      element('span', 'pr-number', `#${item.ref.number}`),
      element('span', 'language-tag', item.ref.language),
    );
    projectCopy.append(
      projectLine,
      link(
        item.pull.data?.title ?? 'PRを取得できませんでした',
        href,
        'pr-title',
      ),
    );
    const focus = element('div', 'row-focus', item.ref.focus);
    projectCopy.append(focus);
    if (hasErrors(item))
      projectCopy.append(
        element('span', 'stale-note', '一部未取得 · 保存済みの情報を含みます'),
      );
    projectCell.append(badge, projectCopy);
    const stateCell = element('td', 'status-cell');
    stateCell.dataset['label'] = '状態 / レビュー';
    const state = item.pull.data?.state;
    stateCell.append(
      state
        ? pill(stateLabel(state), state.kind)
        : pill('取得できず', 'unavailable'),
      element(
        'span',
        'review-label',
        REVIEW_LABELS[humanReviewState(item.reviews)],
      ),
    );
    const ciCell = element('td', 'ci-cell');
    ciCell.dataset['label'] = 'CI / CHECKS';
    const ci = ciState(item);
    ciCell.append(
      pill(CI_LABELS[ci], ci),
      element(
        'span',
        'ci-caption',
        ci === 'action-required'
          ? 'メンテナーの操作待ち'
          : ci === 'passed'
            ? '取得時の最新コミット'
            : '取得済みの実行記録から集計',
      ),
    );
    const detailCell = element('td', 'detail-cell');
    const details = element('details');
    const summary = element('summary', '', '詳細');
    summary.setAttribute(
      'aria-label',
      `${item.ref.owner}/${item.ref.repo} #${item.ref.number} の詳細`,
    );
    const detailsPanel = element('div', 'details-panel');
    detailsPanel.append(element('strong', '', '取得した記録'));
    if (item.pull.data)
      detailsPanel.append(
        element(
          'p',
          'commit-id',
          `commit ${item.pull.data.headSha.slice(0, 12)}`,
        ),
      );
    for (const [name, source] of [
      ['PR', item.pull],
      ['レビュー', item.reviews],
      ['Checks', item.checks],
      ['Commit status', item.statuses],
      ['Actions', item.workflows],
    ] as const) {
      detailsPanel.append(
        element(
          'p',
          '',
          `${name}: ${source.status === 'error' ? source.message : '取得済み'}${source.fetchedAt ? ` / ${date(source.fetchedAt)}` : ''}`,
        ),
      );
    }
    const humans = item.reviews.data?.filter((review) => !review.isBot) ?? [];
    for (const review of humans)
      detailsPanel.append(
        element('p', '', `${review.author}: ${review.decision}`),
      );
    const runs = [...(item.workflows.data ?? []), ...(item.checks.data ?? [])];
    const unique = new Set<string>();
    for (const run of runs)
      if (run.url && !unique.has(run.url)) {
        unique.add(run.url);
        detailsPanel.append(
          link(`${run.name}: ${run.conclusion ?? run.status} ↗`, run.url),
        );
      }
    details.append(summary, detailsPanel);
    detailCell.append(details);
    row.append(projectCell, stateCell, ciCell, detailCell);
    return row;
  }
  function renderRows(): void {
    for (const [key, button] of filterButtons) {
      const count = snapshot.contributions.filter(
        (item) => key === 'all' || item.pull.data?.state.kind === key,
      ).length;
      button.textContent = `${filterLabels[key]} ${count}`;
      button.setAttribute('aria-pressed', String(filter === key));
    }
    const visible = snapshot.contributions.filter((item) => {
      return (
        (filter === 'all' || item.pull.data?.state.kind === filter) &&
        (language === 'all' || item.ref.language === language) &&
        `${contributionId(item.ref)} ${item.pull.data?.title ?? ''} ${item.ref.focus}`
          .toLowerCase()
          .includes(query)
      );
    });
    tbody.replaceChildren(...visible.map(rowFor));
    if (visible.length === 0) {
      const row = element('tr');
      const cell = element(
        'td',
        'empty-state',
        '条件に一致するPRはありません。検索語や絞り込みを変更してください。',
      );
      cell.colSpan = 4;
      row.append(cell);
      tbody.append(row);
    }
    results.textContent = `${visible.length} / ${snapshot.contributions.length} 件を表示 · AIレビューの成功は、人による承認とは別です。`;
  }
  function update(next: Snapshot): void {
    snapshot = next;
    updated.textContent = `取得時刻 ${date(snapshot.capturedAt)}`;
    renderFeatured();
    renderMetrics();
    renderRows();
    const errors = snapshot.contributions.filter(hasErrors).length;
    if (errors > 0)
      notify(
        `${errors}件で一部の情報を取得できませんでした。各PRの詳細で、取得時刻と保存済みの情報を確認できます。`,
        true,
      );
  }
  function notify(message: string, warning = false): void {
    banner.hidden = false;
    banner.className = warning ? 'banner banner--warning' : 'banner';
    banner.textContent = message;
  }
  update(snapshot);
  return {
    update,
    notify,
    setBusy(busy) {
      refresh.disabled = busy;
      refresh.textContent = busy ? '取得中…' : '↻ GitHubから更新';
      refresh.setAttribute('aria-busy', String(busy));
    },
    progress(done, total) {
      refresh.textContent = `取得中 ${done} / ${total}`;
    },
  };
}
