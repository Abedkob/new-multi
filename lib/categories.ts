/**
 * Pure helpers for the category tree (no database access). Categories form a forest of any
 * depth; every helper guards against cycles so a bad row can never cause an infinite loop.
 */

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  imageUrl: string | null;
};

export type FlatCategory<T extends CategoryNode> = T & {
  depth: number;
  /** "Men / Shoes / Nike" */
  path: string;
};

/** Depth-first, siblings sorted by name. Orphans (missing parent) are treated as roots. */
export function flattenCategories<T extends CategoryNode>(cats: T[]): FlatCategory<T>[] {
  const ids = new Set(cats.map((c) => c.id));
  const byParent = new Map<string | null, T[]>();
  for (const c of cats) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const out: FlatCategory<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string[]) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // cycle guard
      seen.add(c.id);
      const path = [...prefix, c.name];
      out.push({ ...c, depth, path: path.join(" / ") });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, []);
  return out;
}

/** The category and everything below it (its own id included). */
export function descendantIds(cats: CategoryNode[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of cats) {
    if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  }
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/** Root-to-node chain, for breadcrumbs. */
export function categoryChain<T extends CategoryNode>(cats: T[], id: string): T[] {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const chain: T[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    chain.unshift(cur);
  }
  return chain;
}
