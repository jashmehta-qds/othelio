"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modal semantics keep focus inside the task and restore it on close. */
export function Dialog({ open, onClose, title, description, children, footer, size = "compact", kind = "modal" }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "compact" | "wide";
  kind?: "modal" | "sheet";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return <dialog ref={ref} className="ui-dialog" data-size={size} data-kind={kind}
    aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="ui-dialog-header">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="ui-icon-button" aria-label="Close dialog" onClick={onClose}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>
    <div className="ui-dialog-body">{open ? children : null}</div>
    {footer && <footer className="ui-dialog-footer">{footer}</footer>}
  </dialog>;
}
