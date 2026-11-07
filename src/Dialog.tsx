import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
export function Dialog({ title, children, onClose, focusTitle = false, returnFocus }: { title: string; children: ReactNode; onClose: () => void; focusTitle?: boolean; returnFocus?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!; element.showModal();
    if (focusTitle) element.querySelector<HTMLElement>('.dialog-head h2')?.focus();
    return () => { element.close(); if (returnFocus) queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); }); };
  }, [focusTitle, returnFocus]);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2 id="dialog-title" tabIndex={focusTitle ? -1 : undefined}>{title}</h2><button onClick={onClose} aria-label="閉じる">閉じる</button></div>
    {children}
  </dialog>;
}

