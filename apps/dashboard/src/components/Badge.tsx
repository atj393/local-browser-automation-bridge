import type { ReactNode } from 'react';

export type BadgeVariant = 'ok' | 'warn' | 'danger' | 'muted';

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={`badge ${variant}`}>{children}</span>;
}
