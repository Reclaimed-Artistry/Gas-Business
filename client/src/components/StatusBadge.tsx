import React from 'react';
import { formatStatusLabel, getStatusClasses } from '../lib/format';

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap ${getStatusClasses(
        status
      )} ${className}`}
    >
      {formatStatusLabel(status)}
    </span>
  );
}
