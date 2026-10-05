// Copyright (c) 2025 cmutnik
// Getting a model ready to cut: bring a heavy model down to a size the browser can build joints on. Parts are { name, color, slot?, positions, indices }.
// Uses manifold-3d's simplify, which merges tiny edges while keeping the surface within a tolerance, and always returns a closed solid.
// Colour patches of one surface (parts sharing a `group`) are simplified together and split by colour again afterwards.
import { loadManifold, toManifold, fromManifold } from '../mesh-modifier/boolean3d.js';
import { partStats, mergeGroups } from '../mesh-modifier/geometry.js';
import { splitByLabel } from './flexi.js';

export const SOFT_LIMIT = 150_000;      // above this the joints are slow to build
export const HARD_LIMIT = 600_000;      // above this the page refuses to try

/**
 * Reduce the ticked parts to about `target` triangles in total by simplifying every closed solid, trying a tolerance that doubles from
 * `maxDeviation / 64` until the total is small enough or `maxDeviation` (the furthest the surface may move, in the model's units) is reached.
 * Solids that are not closed cannot be simplified and are left as they are.
 * Returns { list: [{ part, from }] (the new parts in order, `from` = index in `parts`), before, after, deviation, reached, open: [names] }.
 */
export async function simplifyParts(parts, { include = parts.map(() => true), target = 100_000, maxDeviation = 0.5 } = {}) {
  const used = parts.map((p, i) => ({ p, i })).filter(x => include[x.i]);
  const items = mergeGroups(used.map(x => x.p)).map(item => ({ item, from: (item.members || [item]).map(m => used.find(x => x.p === m).i) }));
  const before = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  const closed = items.map(x => partStats(x.item).openEdges === 0), open = items.filter((_, k) => !closed[k]).map(x => x.item.name);
  const keepList = () => parts.map((part, from) => ({ part, from }));
  if (before <= target) return { list: keepList(), before, after: before, deviation: 0, reached: true, open };
  const w = await loadManifold(), made = [], keep = m => { made.push(m); return m; };
  try {
    const solids = items.map((x, k) => (closed[k] ? keep(toManifold(w, x.item)) : null)), origin = solids.map(m => m && m.getMesh().runOriginalID[0]);
    const fixed = before - items.reduce((s, x, k) => s + (closed[k] ? x.item.indices.length / 3 : 0), 0);   // open solids and unticked parts keep their triangles
    let tol = maxDeviation / 64, best = null;
    for (; ; tol *= 2) {
      const t = Math.min(tol, maxDeviation), simple = solids.map(m => (m ? keep(m.simplify(t)) : null));
      const total = fixed + simple.reduce((s, m) => s + (m ? m.numTri() : 0), 0);
      best = { simple, total, tol: t };
      if (total <= target || t >= maxDeviation) break;
    }
    const replaced = new Map();                                               // original index -> its new parts
    items.forEach((x, k) => {
      if (!best.simple[k]) return;
      if (!x.item.members) { replaced.set(x.from[0], [{ part: fromManifold(best.simple[k], x.item), from: x.from[0] }]); return; }
      const subs = splitByLabel(best.simple[k], origin[k]);
      replaced.set(x.from[0], subs.map(sub => ({ part: { ...x.item.members[sub.label], positions: sub.positions, indices: sub.indices }, from: x.from[sub.label] })));
      x.from.slice(1).forEach(i => replaced.set(i, []));                      // the group's other members are covered by the first entry
    });
    const list = [];
    parts.forEach((part, i) => { if (replaced.has(i)) list.push(...replaced.get(i)); else list.push({ part, from: i }); });
    return { list, before, after: best.total, deviation: best.tol, reached: best.total <= target, open };
  } finally { made.forEach(m => m.delete()); }
}
