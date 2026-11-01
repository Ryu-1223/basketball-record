import { useEffect, useRef, type ReactNode } from 'react';
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!; element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button onClick={onClose} aria-label="閉じる">閉じる</button></div>
    {children}
  </dialog>;
}

