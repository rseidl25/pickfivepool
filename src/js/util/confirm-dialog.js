// Self-contained confirm dialog — replaces native confirm(). Injects its own
// styles on first use so it works on any page (M3-themed or /v1 legacy)
// without needing a stylesheet link. Returns a Promise<boolean>, so callers
// swap `if (!confirm(msg)) return;` for `if (!(await showConfirm(msg))) return;`.
let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pick5-confirm-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 3100; padding: 20px;
    }
    .pick5-confirm-box {
      background: #fff; border-radius: 12px; max-width: 400px; width: 100%;
      padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      font-family: Montserrat, Arial, sans-serif;
    }
    .pick5-confirm-message {
      margin: 0 0 20px; font-size: 15px; line-height: 1.5; color: #1a1a1a;
      white-space: pre-line;
    }
    .pick5-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .pick5-confirm-actions button {
      padding: 10px 18px; border-radius: 999px; border: none;
      font-weight: 700; font-size: 14px; cursor: pointer; font-family: inherit;
      transition: background-color .15s ease;
    }
    .pick5-confirm-cancel { background: #eee; color: #333; }
    .pick5-confirm-cancel:hover { background: #ddd; }
    .pick5-confirm-ok { background: #1d2d44; color: #fff; }
    .pick5-confirm-ok:hover { background: #16233a; }
    .pick5-confirm-ok.pick5-confirm-danger { background: #dc2626; }
    .pick5-confirm-ok.pick5-confirm-danger:hover { background: #b91c1c; }
  `;
  document.head.appendChild(style);
}

// options: { confirmText, cancelText, danger }
export function showConfirm(message, options = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "pick5-confirm-overlay";

    const box = document.createElement("div");
    box.className = "pick5-confirm-box";

    const msgEl = document.createElement("p");
    msgEl.className = "pick5-confirm-message";
    msgEl.textContent = message;
    box.appendChild(msgEl);

    const actions = document.createElement("div");
    actions.className = "pick5-confirm-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pick5-confirm-cancel";
    cancelBtn.textContent = options.cancelText || "Cancel";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pick5-confirm-ok" + (options.danger ? " pick5-confirm-danger" : "");
    okBtn.textContent = options.confirmText || "Confirm";

    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") cleanup(false);
    }
    document.addEventListener("keydown", onKey);

    cancelBtn.onclick = () => cleanup(false);
    okBtn.onclick = () => cleanup(true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });

    okBtn.focus();
  });
}
