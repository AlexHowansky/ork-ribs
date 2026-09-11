// Applies the saved colour theme before first paint so the page never flashes
// the wrong theme. "System" is the absence of a saved choice.
(function () {
  try {
    var pref = localStorage.getItem("ribs-theme");
    if (pref === "light") document.documentElement.setAttribute("data-theme", "winter");
    else if (pref === "dark") document.documentElement.setAttribute("data-theme", "night");
  } catch (e) {
    /* storage unavailable: follow the system setting */
  }
})();
