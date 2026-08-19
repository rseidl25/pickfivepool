// Site-wide theme switcher. Three explicit options (no OS-linked "system"
// option): Original (v1's navy/gold flat palette, mapped onto the v2 M3
// component structure), Light and Dark (the v2 M3 palettes). Persisted in
// localStorage and applied via a data-theme attribute on <html>, which the
// token blocks in m3-tokens.css key off of.
const STORAGE_KEY = "pick5-theme";
const THEMES = ["original", "light", "dark"];
const DEFAULT_THEME = "original";

export function getStoredTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(saved) ? saved : DEFAULT_THEME;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", THEMES.includes(theme) ? theme : DEFAULT_THEME);
}

export function setTheme(theme) {
  const t = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  localStorage.setItem(STORAGE_KEY, t);
  applyTheme(t);
}

// Wires up a .m3-segmented control (buttons with data-theme-option="...")
// to read/write the current theme. Safe to call on any page that has one.
export function initThemeSwitcher(containerId = "theme-segmented") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const buttons = container.querySelectorAll("[data-theme-option]");

  function syncSelected() {
    const current = getStoredTheme();
    buttons.forEach((b) => b.classList.toggle("selected", b.dataset.themeOption === current));
  }

  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      setTheme(b.dataset.themeOption);
      syncSelected();
    });
  });

  syncSelected();
}
