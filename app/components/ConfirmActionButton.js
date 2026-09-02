"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./interface-patterns.module.css";

function ConfirmationDialog({ dialogRef, title, message, confirmLabel, cancelLabel, onConfirm }) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const cancel = (event) => {
      event.preventDefault();
      dialog.close();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, [dialogRef]);

  return <dialog ref={dialogRef} className={styles.confirmDialog} aria-labelledby={titleId} aria-describedby={descriptionId}>
    <h2 id={titleId} className={styles.confirmTitle}>{title}</h2>
    <p id={descriptionId} className={styles.confirmMessage}>{message}</p>
    <div className={styles.confirmActions}>
      <button type="button" className={styles.cancelButton} onClick={() => dialogRef.current?.close()}>{cancelLabel}</button>
      <button type="button" className={styles.confirmButton} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}

export default function ConfirmActionButton({
  children,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Keep it",
  onConfirm,
  disabled = false,
  className,
  style
}) {
  const dialogRef = useRef(null);
  async function confirm() {
    dialogRef.current?.close();
    await onConfirm?.();
  }
  return <>
    <button type="button" disabled={disabled} className={className} style={style} onClick={() => dialogRef.current?.showModal()}>{children}</button>
    <ConfirmationDialog dialogRef={dialogRef} title={title} message={message} confirmLabel={confirmLabel} cancelLabel={cancelLabel} onConfirm={confirm} />
  </>;
}

export function ConfirmSubmitButton({ formId, children, title, message, confirmLabel = "Confirm", cancelLabel = "Keep playing", className, style }) {
  const dialogRef = useRef(null);
  function confirm() {
    dialogRef.current?.close();
    document.getElementById(formId)?.requestSubmit();
  }
  return <>
    <button type="button" className={className} style={style} onClick={() => dialogRef.current?.showModal()}>{children}</button>
    <ConfirmationDialog dialogRef={dialogRef} title={title} message={message} confirmLabel={confirmLabel} cancelLabel={cancelLabel} onConfirm={confirm} />
  </>;
}
