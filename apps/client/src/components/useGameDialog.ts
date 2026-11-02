import { useLayoutEffect, useRef } from 'react';
import { inputHandler } from '../game/input';
export function useGameDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null),
    close = useRef(onClose);
  // Capture the trigger before React autoFocus moves focus into a newly mounted dialog.
  const previousFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  close.current = onClose;
  useLayoutEffect(() => {
    if (!open) {
      const rememberFocus = () => {
        const target = document.activeElement;
        if (target instanceof HTMLElement && target !== document.body && !ref.current?.contains(target))
          previousFocus.current = target;
      };
      rememberFocus();
      document.addEventListener('focusin', rememberFocus);
      // Layout cleanup runs before autoFocus when an always-mounted dialog opens.
      return () => document.removeEventListener('focusin', rememberFocus);
    }
    const previous = previousFocus.current;
    inputHandler.suspend();
    const dialog = ref.current;
    if (dialog && !dialog.contains(document.activeElement))
      dialog
        .querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')
        ?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab' && dialog) {
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ].filter((el) => el.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      inputHandler.resume();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return ref;
}
