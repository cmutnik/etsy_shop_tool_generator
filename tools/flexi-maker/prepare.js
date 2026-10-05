// Copyright (c) 2025 cmutnik
// Getting a model ready to cut: bring a heavy model down to a size the browser can build joints on. Parts are { name, color, slot?, positions, indices }.
// Uses manifold-3d's simplify, which merges tiny edges while keeping the surface within a tolerance, and always returns a closed solid.
import { loadManifold, toManifold, fromManifold } from '../mesh-modifier/boolean3d.js';
import { partStats } from '../mesh-modifier/geometry.js';

export const SOFT_LIMIT = 150_000;      // above this the joints are slow to build
export const HARD_LIMIT = 600_000;      // above this the page refuses to try

/**
 * Reduce the model to about `target` triangles by simplifying every closed part, trying a tolerance that doubles from `maxDeviation / 64`
 * until the total is small enough or `maxDeviation` (mm: the furthest the surface may move) is reached. Open parts cannot be simplified
 * and are left as they are. Returns { parts, before, after, deviation, reached, open: [names] }.
 */
export async function simplifyParts(parts, { target = 100_000, maxDeviation = 0.5 } = {}) {
  const before = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  const closed = parts.map(p => partStats(p).openEdges === 0), open = parts.filter((_, i) => !closed[i]).map(p => p.name);
  if (before <= target) return { parts, before, after: before, deviation: 0, reached: true, open };
  const w = await loadManifold(), made = [], keep = m => { made.push(m); return m; };
  try {
    const solids = parts.map((p, i) => (closed[i] ? keep(toManifold(w, p)) : null));
    const fixed = parts.reduce((s, p, i) => s + (closed[i] ? 0 : p.indices.length / 3), 0);       // open parts keep their triangles
    let tol = maxDeviation / 64, best = null;
    for (; ; tol *= 2) {
      const t = Math.min(tol, maxDeviation);
      const simple = solids.map(m => (m ? keep(m.simplify(t)) : null));
      const total = fixed + simple.reduce((s, m) => s + (m ? m.numTri() : 0), 0);
      best = { simple, total, tol: t };
      if (total <= target || t >= maxDeviation) break;
    }
    const out = parts.map((p, i) => (best.simple[i] ? fromManifold(best.simple[i], p) : p));
    return { parts: out, before, after: best.total, deviation: best.tol, reached: best.total <= target, open };
  } finally { made.forEach(m => m.delete()); }
}
