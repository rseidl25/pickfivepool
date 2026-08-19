// Wires up a hamburger trigger + overlay dropdown pair (see .m3-menu-wrap in
// m3-tokens.css). Generic/reusable — doesn't know what the menu items do,
// just handles opening, closing on outside click, closing on Escape, and
// closing after any item inside is clicked (so the menu doesn't stay open
// covering whatever modal/action that item just triggered).
export function initHeaderMenu(triggerId = "menu-trigger", menuId = "header-menu") {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  if (!trigger || !menu) return;

  function setOpen(open) {
    menu.classList.toggle("hidden", !open);
    trigger.setAttribute("aria-expanded", String(open));
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.classList.contains("hidden"));
  });

  menu.querySelectorAll(".m3-menu-item").forEach((item) => {
    item.addEventListener("click", () => setOpen(false));
  });

  window.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target !== trigger) {
      setOpen(false);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}
