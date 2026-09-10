import { h } from "./dom.ts";

export interface Tab {
  /** Unique within the page; used to link each tab to its panel. */
  id: string;
  label: string;
  panel: HTMLElement;
}

/**
 * daisyUI tabs with the WAI-ARIA tabs pattern: one tab stop, arrow keys and
 * Home/End move between tabs, and the panel changes as the tab does. The first
 * tab starts selected. `onSelect` runs every time a tab is chosen, including
 * a re-selection of the tab already showing.
 */
export function tabs(label: string, items: Tab[], onSelect: (id: string) => void = () => {}): HTMLElement {
  const buttons = items.map(({ id, label: text }, i) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        id: `${id}-tab`,
        class: "tab",
        "aria-controls": `${id}-panel`,
        "aria-selected": String(i === 0),
        tabindex: i === 0 ? "0" : "-1",
      },
      text,
    ),
  );
  const panels = items.map(({ id, panel }, i) => {
    panel.id = `${id}-panel`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `${id}-tab`);
    panel.tabIndex = 0;
    panel.hidden = i !== 0;
    return panel;
  });

  function select(index: number, focus: boolean): void {
    buttons.forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === index));
      b.tabIndex = i === index ? 0 : -1;
      panels[i]!.hidden = i !== index;
    });
    if (focus) buttons[index]!.focus();
    onSelect(items[index]!.id);
  }

  const list = h("div", { role: "tablist", "aria-label": label, class: "tabs tabs-border" }, ...buttons);
  buttons.forEach((b, i) => b.addEventListener("click", () => select(i, false)));
  list.addEventListener("keydown", (e) => {
    const current = buttons.findIndex((b) => b === document.activeElement);
    if (current < 0) return;
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select((next + buttons.length) % buttons.length, true);
  });

  return h("div", { class: "flex flex-col gap-4" }, list, ...panels);
}
