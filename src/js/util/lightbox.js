// Click-to-expand PROFILE PHOTO viewer — shown as a large circular avatar
// (matching the small round profile pics it's expanding from) rather than
// a raw rectangular image, so it reads as a native app element instead of
// an image-viewer overlay. Injects its own styles on first use, same
// pattern as toast.js/confirm-dialog.js, so it works on any page without a
// stylesheet link. Closes via the X, clicking outside the image, or Escape.
let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pick5-lightbox-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      display: flex; align-items: center; justify-content: center;
      z-index: 3200; padding: 32px; cursor: zoom-out;
    }
    .pick5-lightbox-img {
      width: min(45vw, 45vh, 320px); height: min(45vw, 45vh, 320px);
      border-radius: 50%; object-fit: cover; cursor: default;
      border: 4px solid var(--md-sys-color-surface-container-lowest, #fff);
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    }
    .pick5-lightbox-close {
      position: fixed; top: 16px; right: 20px; font-size: 32px; line-height: 1;
      color: #fff; cursor: pointer; user-select: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * @param url image URL to show expanded
 * @param alt alt text, reused for the expanded image
 */
export function openLightbox(url, alt = "") {
  if (!url) return;
  ensureStyles();

  const overlay = document.createElement("div");
  overlay.className = "pick5-lightbox-overlay";

  const img = document.createElement("img");
  img.className = "pick5-lightbox-img";
  img.src = url;
  img.alt = alt;

  const closeBtn = document.createElement("span");
  closeBtn.className = "pick5-lightbox-close";
  closeBtn.innerHTML = "&times;";

  overlay.append(img, closeBtn);
  document.body.appendChild(overlay);

  function cleanup() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") cleanup();
  }
  document.addEventListener("keydown", onKey);

  overlay.addEventListener("click", (e) => {
    if (e.target !== img) cleanup();
  });
}
