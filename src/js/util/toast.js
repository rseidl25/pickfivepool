// Self-contained toast/snackbar — replaces native alert(). Injects its own
// styles on first use so it works on any page (M3-themed or /v1 legacy)
// without needing a stylesheet link. Message is always set via textContent,
// never innerHTML, since callers pass user-controlled strings (display
// names, league names, error messages).
let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    #pick5-toast-container {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      z-index: 3000; display: flex; flex-direction: column; gap: 8px;
      align-items: center; pointer-events: none; width: min(90vw, 420px);
    }
    .pick5-toast {
      pointer-events: auto; width: 100%; box-sizing: border-box;
      padding: 12px 18px; border-radius: 10px; color: #fff;
      font: 600 14px/1.4 Montserrat, Arial, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      opacity: 0; transform: translateY(12px);
      transition: opacity .25s ease, transform .25s ease;
      text-align: center;
    }
    .pick5-toast.pick5-toast-show { opacity: 1; transform: translateY(0); }
    .pick5-toast-success { background: #16a34a; }
    .pick5-toast-error { background: #dc2626; }
    .pick5-toast-info { background: #1d2d44; }
  `;
  document.head.appendChild(style);
}

function ensureContainer() {
  let container = document.getElementById("pick5-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "pick5-toast-container";
    document.body.appendChild(container);
  }
  return container;
}

// type: "success" | "error" | "info"
export function showToast(message, type = "info", duration = 4000) {
  ensureStyles();
  const container = ensureContainer();

  const el = document.createElement("div");
  el.className = `pick5-toast pick5-toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add("pick5-toast-show"));

  setTimeout(() => {
    el.classList.remove("pick5-toast-show");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, duration);
}
