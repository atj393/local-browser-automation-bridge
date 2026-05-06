import type { ReactNode } from 'react';

export function WarningBox({ children }: { children: ReactNode }) {
  return <div className="warning-box">{children}</div>;
}
