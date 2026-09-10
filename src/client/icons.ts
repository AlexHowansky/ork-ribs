import { config, icon, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faDesktop,
  faLocationCrosshairs,
  faLocationDot,
  faMinus,
  faMoon,
  faPlus,
  faRotateLeft,
  faSun,
  faTriangleExclamation,
  faUtensils,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

// The one rule these SVGs need lives in styles.css; letting Font Awesome inject
// a <style> element at runtime would be blocked by the Content-Security-Policy.
config.autoAddCss = false;

const ICONS: Record<string, IconDefinition> = {
  "circle-check": faCircleCheck,
  "circle-info": faCircleInfo,
  "circle-xmark": faCircleXmark,
  desktop: faDesktop,
  "location-crosshairs": faLocationCrosshairs,
  "location-dot": faLocationDot,
  minus: faMinus,
  moon: faMoon,
  plus: faPlus,
  "rotate-left": faRotateLeft,
  sun: faSun,
  "triangle-exclamation": faTriangleExclamation,
  utensils: faUtensils,
  xmark: faXmark,
};

export type IconName = keyof typeof ICONS;

/**
 * A decorative Font Awesome SVG. It is always hidden from assistive technology:
 * the control that holds it must say what it does with visible text or an aria-label.
 */
export function faIcon(name: IconName): SVGElement {
  const def = ICONS[name];
  if (!def) throw new Error(`Unknown icon: ${name}`);
  const svg = icon(def).node[0] as SVGElement;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

/** Replace every `<span data-icon="name">` placeholder under `root` with its SVG. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = el.dataset.icon as IconName;
    el.removeAttribute("data-icon");
    el.replaceChildren(faIcon(name));
    el.setAttribute("aria-hidden", "true");
  }
}
