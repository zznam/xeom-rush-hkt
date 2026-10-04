import { useEffect, useRef, type ReactNode } from 'react';
export default function Dialog({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby='dialog-title'
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className='dialog-heading'>
        <h2 id='dialog-title'>{title}</h2>
        <button aria-label='Close dialog' onClick={onCancel}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
