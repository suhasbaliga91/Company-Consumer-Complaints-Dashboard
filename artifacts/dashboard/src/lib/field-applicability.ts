import { Case } from '@workspace/api-client-react';

/**
 * Whether a field the extraction pipeline can populate is actually meaningful
 * for the active taxonomy — e.g. `is_ev`/`part_category` are automotive-only
 * concepts that a different industry's taxonomy (see scraper/taxonomy.py)
 * intentionally always returns null for.
 *
 * We can't ask the taxonomy directly (the dashboard has no access to the
 * Python config), so we infer it from the data: once extraction has actually
 * run and a field is still null on every case, treat it as unused by this
 * deployment's taxonomy rather than "not extracted yet".
 */
export function isFieldApplicable(cases: Case[], fields: (keyof Case)[]): boolean {
  const extractionHasRun = cases.some(
    (c) => c.extraction_status === 'full' || c.extraction_status === 'sample',
  );
  if (!extractionHasRun) return true; // can't tell yet — show the normal "pending" state

  return cases.some((c) =>
    fields.some((f) => c[f] !== null && c[f] !== undefined),
  );
}
