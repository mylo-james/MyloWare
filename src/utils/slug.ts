export function normaliseSlug(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const hyphenated = trimmed.replace(/\s+/g, '-');
  const cleaned = hyphenated.replace(/[^a-z0-9-]/g, '');
  const collapsed = cleaned.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  return collapsed.length > 0 ? collapsed : null;
}

export function normaliseSlugOptional(value?: string | null): string | undefined {
  const slug = normaliseSlug(value);
  return slug ?? undefined;
}
