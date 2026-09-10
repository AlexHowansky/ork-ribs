import { faIcon, type IconName } from "./icons.ts";
import { log } from "./log.ts";

/** What the reader chose. "system" follows the operating system's light/dark setting. */
export type ThemePref = "light" | "dark" | "system";
/** The daisyUI theme actually in effect. */
export type ThemeName = "winter" | "night";

const STORAGE_KEY = "ork-theme"; // also read by public/theme-init.js before first paint
const THEME_FOR: Record<Exclude<ThemePref, "system">, ThemeName> = { light: "winter", dark: "night" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(theme: ThemeName) => void>();

export function getPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function effectiveTheme(pref: ThemePref = getPref()): ThemeName {
  if (pref === "system") return darkQuery.matches ? "night" : "winter";
  return THEME_FOR[pref];
}

function apply(pref: ThemePref): void {
  const root = document.documentElement;
  // With no data-theme attribute daisyUI picks winter or night from prefers-color-scheme itself.
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", THEME_FOR[pref]);
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-theme-pref]")) {
    const on = btn.dataset.themePref === pref;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("btn-active", on);
  }
  const theme = effectiveTheme(pref);
  for (const fn of listeners) fn(theme);
}

export function setPref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch (err) {
    log.warn("could not save theme preference", { err: err as Error });
  }
  log.info("theme changed", { pref });
  apply(pref);
}

export function onThemeChange(fn: (theme: ThemeName) => void): void {
  listeners.add(fn);
}

const OPTIONS: { pref: ThemePref; label: string; icon: IconName }[] = [
  { pref: "light", label: "Light", icon: "sun" },
  { pref: "dark", label: "Dark", icon: "moon" },
  { pref: "system", label: "System", icon: "desktop" },
];

/** Render the Light / Dark / System control into `container` (a `.join` with role="group"). */
export function mountThemeControl(container: HTMLElement): void {
  for (const { pref, label, icon } of OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm join-item px-2.5";
    btn.dataset.themePref = pref;
    const text = document.createElement("span");
    text.textContent = label;
    btn.append(faIcon(icon), text);
    btn.addEventListener("click", () => setPref(pref));
    container.append(btn);
  }
  darkQuery.addEventListener("change", () => {
    if (getPref() === "system") apply("system");
  });
  apply(getPref());
}
