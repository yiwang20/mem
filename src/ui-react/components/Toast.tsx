import { createContext, useCallback, useContext, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Style config per type
// ---------------------------------------------------------------------------

const TOAST_CONFIG: Record<ToastType, { icon: string; accent: string }> = {
  success: { icon: '✓', accent: '#6B9E8A' },
  error: { icon: '✕', accent: '#C47A7A' },
  info: { icon: 'i', accent: '#6B8EC4' },
};

// ---------------------------------------------------------------------------
// Individual toast item
// ---------------------------------------------------------------------------

interface ToastItemProps {
  item: ToastItem;
  onDismiss: (id: number) => void;
}

function ToastItemView({ item, onDismiss }: ToastItemProps) {
  const config = TOAST_CONFIG[item.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-md)',
        padding: '12px 16px',
        minWidth: '280px',
        maxWidth: '400px',
        animation: 'toast-slide-in 0.2s ease-out',
        cursor: 'pointer',
      }}
      onClick={() => onDismiss(item.id)}
    >
      {/* Colored icon dot */}
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '9999px',
          backgroundColor: config.accent,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 700,
          flexShrink: 0,
          marginTop: '1px',
        }}
      >
        {config.icon}
      </div>

      {/* Message */}
      <div
        style={{
          flex: 1,
          fontSize: '14px',
          color: 'var(--text)',
          lineHeight: 1.5,
        }}
      >
        {item.message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => dismiss(id), 3000);
  }, [dismiss]);

  const ctx: ToastContextValue = {
    success: useCallback((m) => add('success', m), [add]),
    error: useCallback((m) => add('error', m), [add]),
    info: useCallback((m) => add('info', m), [add]),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}

      {/* Toast stack — bottom-right */}
      {toasts.length > 0 && (
        <>
          <style>{`
            @keyframes toast-slide-in {
              from { opacity: 0; transform: translateX(16px); }
              to   { opacity: 1; transform: translateX(0); }
            }
          `}</style>
          <div
            aria-live="polite"
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              pointerEvents: 'none',
            }}
          >
            {toasts.map((t) => (
              <div key={t.id} style={{ pointerEvents: 'auto' }}>
                <ToastItemView item={t} onDismiss={dismiss} />
              </div>
            ))}
          </div>
        </>
      )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
