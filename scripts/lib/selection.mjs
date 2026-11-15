export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch { return String(value); }
}

export function deduplicateSelection(candidates, topId, discussionCandidates = []) {
  const priority = { codex: 5, official: 4, japan: 3, trending: 2, hn: 1 };
  const keyFor = (item) => item.kind === 'claudecode' ? `claudecode:${item.version}` : normalizeUrl(item.url);
  const winners = new Map();
  for (const item of candidates) {
    const key = keyFor(item);
    const previous = winners.get(key);
    if (!previous) { winners.set(key, { ...item }); continue; }
    const winner = (priority[item.kind] ?? 0) > (priority[previous.kind] ?? 0) ? { ...item } : previous;
    const discussions = [previous.discussion, item.discussion].filter(Boolean).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    if (discussions.length) winner.discussion = discussions[0];
    winners.set(key, winner);
  }
  // Discussion links remain useful even when an HN story misses the point cutoff.
  for (const story of discussionCandidates) {
    const winner = winners.get(normalizeUrl(story.url));
    if (!winner || !story.discussion || !['official', 'japan', 'trending'].includes(winner.kind)) continue;
    if (!winner.discussion || (story.discussion.points ?? 0) > (winner.discussion.points ?? 0)) winner.discussion = story.discussion;
  }
  const topItem = candidates.find((item) => item.id === topId);
  const top = topItem ? winners.get(keyFor(topItem)).id : null;
  const selected = [];
  const items = {};
  for (const item of candidates) {
    const winner = winners.get(keyFor(item));
    if (Object.hasOwn(items, winner.id)) continue;
    selected.push(winner.id);
    items[winner.id] = winner;
  }
  const order = { claudecode: 0, codex: 1, official: 2, hn: 3, japan: 4, trending: 5 };
  const published = (item) => Date.parse(item.published) || 0;
  selected.sort((firstId, secondId) => {
    const first = items[firstId];
    const second = items[secondId];
    const category = (order[first.kind] ?? 6) - (order[second.kind] ?? 6);
    if (category) return category;
    if (first.kind === 'hn') return (second.points ?? second.metrics?.points ?? 0) - (first.points ?? first.metrics?.points ?? 0) || published(second) - published(first);
    if (first.kind === 'official' || first.kind === 'japan') return published(second) - published(first);
    if (first.kind === 'trending') return (second.metrics?.starsToday ?? 0) - (first.metrics?.starsToday ?? 0);
    return 0;
  });
  if (top && selected[0] !== top) {
    selected.splice(selected.indexOf(top), 1);
    selected.unshift(top);
  }
  return { top, selected, items };
}
