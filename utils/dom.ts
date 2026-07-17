const sanitizePart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const toDomIdentifier = (...parts: Array<string | number | null | undefined>) => {
  const base = parts
    .map((part) => (part ?? '').toString())
    .map(sanitizePart)
    .filter(Boolean)
    .join('-');

  return base || 'element';
};

export const buildDomId = (...parts: Array<string | number | null | undefined>) =>
  toDomIdentifier(...parts);

export const buildDataTestId = (...parts: Array<string | number | null | undefined>) =>
  `test-${toDomIdentifier(...parts)}`;
