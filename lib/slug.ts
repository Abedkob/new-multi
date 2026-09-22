export function slugify(input: string) {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "item"
  );
}

/** base, base-2, base-3, ... */
export function slugCandidate(base: string, attempt: number) {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
