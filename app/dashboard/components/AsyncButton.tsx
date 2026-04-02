'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface AsyncButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onClick: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * A button wrapper that auto-manages loading state for async actions.
 * Shows a Loader2 spinner and disables itself while the promise is pending.
 * Re-enables on completion or error.
 */
export default function AsyncButton({ onClick, children, disabled, className, ...rest }: AsyncButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onClick();
    } catch {
      // Re-enable on error — caller handles error display
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onClick={handleClick}
      className={className}
    >
      {loading ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
