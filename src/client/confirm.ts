/**
 * The app's own confirmation dialog, used before anything irreversible.
 * (window.confirm is never used: the browser draws it outside our theme.)
 */
export interface ConfirmOptions {
  title: string;
  body: string;
  /** Names the action, e.g. "Reset preferences" — never "OK". */
  actionLabel: string;
}

/** Resolves true only if the reader chose the action; Cancel, Escape, × and the backdrop all resolve false. */
export function confirmAction({ title, body, actionLabel }: ConfirmOptions): Promise<boolean> {
  const dialog = document.getElementById("confirm-dialog") as HTMLDialogElement;
  const action = document.getElementById("confirm-action") as HTMLButtonElement;
  document.getElementById("confirm-title")!.textContent = title;
  document.getElementById("confirm-body")!.textContent = body;
  action.textContent = actionLabel;
  dialog.querySelector<HTMLButtonElement>("button[aria-label^='Close']")?.setAttribute(
    "aria-label",
    `Close without choosing ${actionLabel.toLowerCase()}`,
  );
  dialog.returnValue = "";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}
