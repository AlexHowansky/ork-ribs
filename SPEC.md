## RIBS — Restaurant Inspection and Business Search

You are a web development expert. You are designing a new web application. This
document explains the requirements that must be adhered to.

## Architecture & Design

* The app must be authored in JavaScript or something that transpiles to
  JavaScript. Prefer bun over node.

* Use SQLite for local storage.

* Use Tailwind for styling, with daisyUI on top of it for components and for
  colour. Every colour in the app is one of daisyUI's semantic tokens —
  `base-100`, `base-content`, `primary`, `error` and their neighbours — resolved
  by whichever theme is active; nothing names a palette shade of its own, and
  nothing carries a hand-written dark-mode twin. Always offer light and dark
  mode for visual elements: daisyUI's stock `winter` and `night`. Every page
  carries the light/dark/system control, so the choice can be made or changed
  wherever the reader happens to be.

* Make good use of the screen. A page always takes the full width of the window
  it is in: never a centred column with empty glass either side of it, and never
  a scrollbar inside a panel that had room to be wider.

* Icons come from Font Awesome v7 Free rather than being drawn per control or
  typed as text symbols, so they match each other and render the same
  everywhere. An icon is never the only thing saying what a control does: it
  carries a label a screen reader can read, and a control that pairs an icon
  with a word keeps the word.

* A question asked before something irreversible is the app's own dialog, drawn
  like every other: `window.confirm` is never used, because the browser draws it
  in its own chrome and it ignores the theme and the palette entirely. The button
  that goes through with it names the action rather than saying "OK", so it still
  says what will happen when read on its own, and the question can be refused
  with Escape or the close control as well as with Cancel.

* Observe OWASP Top Ten guidelines.

* Observe best practices for modern web development.

* All error messages should be user-friendly.

* Implement consistent logging to aid debugging.

## Features

* Implement a Google-maps-like map, defaulting to the user's detected current
  location.

* Use the New York State Food Service Establishment data API to search for
  establishments within the visible map area.

* Place an icon at each location where a known establishment is.

* When an icon is clicked, open a modal with details on the establishment.
  Include the following information: name, address, last inspection date, total
  number of critical violations, total number of non-critical violations, list
  of violations.

## Conclusion

Ask me about design decisions or for any additional details you may need.
