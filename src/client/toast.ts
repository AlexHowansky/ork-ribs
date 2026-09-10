import { faIcon, type IconName } from "./icons.ts";

export type ToastKind = "info" | "success" | "warning" | "error";

const ICON: Record<ToastKind, IconName> = {
  info: "circle-info",
  success: "circle-check",
  warning: "triangle-exclamation",
  error: "circle-xmark",
};

const ALERT_CLASS: Record<ToastKind, string> = {
  info: "alert-info",
  success: "alert-success",
  warning: "alert-warning",
  error: "alert-error",
};

/** Show a short message in the corner. Errors stay until dismissed or replaced by the same message. */
export function toast(message: string, kind: ToastKind = "info", timeoutMs = kind === "error" ? 10_000 : 6_000): void {
  const container = document.getElementById("toasts");
  if (!container) return;

  // Don't stack identical messages (e.g. the same network error on every pan).
  for (const existing of container.querySelectorAll<HTMLElement>("[data-message]")) {
    if (existing.dataset.message === message) existing.remove();
  }

  const el = document.createElement("div");
  el.className = `alert ${ALERT_CLASS[kind]} shadow-md max-w-sm whitespace-normal`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.dataset.message = message;

  const text = document.createElement("span");
  text.textContent = message;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-ghost btn-xs btn-circle";
  close.setAttribute("aria-label", "Dismiss message");
  close.title = "Dismiss";
  close.append(faIcon("xmark"));
  close.addEventListener("click", () => el.remove());

  el.append(faIcon(ICON[kind]), text, close);
  container.append(el);
  if (timeoutMs > 0) setTimeout(() => el.remove(), timeoutMs);
}
