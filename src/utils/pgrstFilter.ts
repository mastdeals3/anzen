// ============================================================================
// PostgREST logic-tree filter helpers
// ----------------------------------------------------------------------------
// The string passed to supabase `.or()` / `.and()` is a PostgREST *logic tree*.
// Commas separate conditions and parentheses group them, so any VALUE that may
// contain those characters (a company name like `Maesyheuan Sole Co., LTD` or
// `Test (India) Pvt. Ltd.`) breaks the parser with:
//     "failed to parse logic tree ((email.eq.,company_name.ilike.Foo, Bar))"
//
// PostgREST allows a value to be wrapped in double quotes so its contents are
// taken literally; inside the quotes a backslash and a double quote must be
// backslash-escaped. Building filter strings by raw interpolation is unsafe —
// always route values through `pgrstQuoteValue` (or the higher-level helpers).
// ============================================================================

/**
 * Quote a single value for safe embedding inside a PostgREST logic-tree filter.
 * Handles commas, parentheses, dots, apostrophes, ampersands, quotes, etc.
 */
export function pgrstQuoteValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Build a safe `.or()` filter that matches `term` as a case-insensitive
 * substring (ilike `%term%`) against any of the given columns. The value is
 * quoted so special characters can never break the logic-tree parser.
 *
 *   supabase.from('customers').or(orIlikeContains(['name', 'email'], q))
 */
export function orIlikeContains(columns: string[], term: string): string {
  const quoted = pgrstQuoteValue(`%${term}%`);
  return columns.map((col) => `${col}.ilike.${quoted}`).join(',');
}
