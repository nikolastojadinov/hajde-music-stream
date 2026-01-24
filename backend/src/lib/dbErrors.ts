import type { PostgrestError } from '@supabase/postgrest-js';

export type DbErrorLike = {
  code?: string | number;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
};

export function isDuplicateConstraint(error: unknown, constraintName?: string): boolean {
  const err = error as DbErrorLike | PostgrestError | undefined;
  if (!err) return false;

  const codeValue = (err as any)?.code;
  const code = typeof codeValue === 'number' ? String(codeValue) : codeValue;
  if (code !== '23505') return false;

  if (!constraintName) return true;

  const constraintFields: Array<string | undefined> = [
    (err as any)?.constraint,
    (err as any)?.message,
    (err as any)?.details,
    (err as any)?.hint,
  ];

  return constraintFields.some((field) => typeof field === 'string' && field.includes(constraintName));
}
