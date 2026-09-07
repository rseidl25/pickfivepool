// Self-contained crop dialog — shown between "user picked a file" and
// "upload it", so every uploaded photo ends up a well-framed square instead
// of whatever aspect ratio the source photo happened to be (every avatar in
// this app is displayed as a circle via object-fit: cover, so an off-center
// or non-square source photo can crop out the subject's face entirely).
// Same self-styling pattern as confirm-dialog.js: injects its own <style> so
// it works on any page without a stylesheet link, themed via the M3 tokens
// with literal fallbacks for /v1 legacy pages.
import { showToast } from "./toast.js";

const STAGE_SIZE = 280; // on-screen crop frame, px
const OUTPUT_SIZE = 500; // exported image is always this many px square

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .pick5-crop-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 3200; padding: 20px;
    }
    .pick5-crop-box {
      background: var(--md-sys-color-surface-container-high, #fff);
      border-radius: var(--md-sys-shape-corner-xl, 12px); max-width: 360px; width: 100%;
      padding: 24px; box-shadow: var(--md-sys-elevation-3, 0 8px 30px rgba(0,0,0,0.4));
      font-family: Montserrat, Arial, sans-serif;
      display: flex; flex-direction: column; align-items: center;
    }
    .pick5-crop-title {
      margin: 0 0 16px; font-size: 16px; font-weight: 700;
      color: var(--md-sys-color-on-surface, #1a1a1a); align-self: flex-start;
    }
    .pick5-crop-stage {
      position: relative; width: ${STAGE_SIZE}px; height: ${STAGE_SIZE}px;
      overflow: hidden; border-radius: 50%; touch-action: none; cursor: grab;
      background: var(--md-sys-color-surface-container-highest, #333);
      box-shadow: 0 0 0 2px var(--md-sys-color-outline-variant, #ccc);
    }
    .pick5-crop-stage.dragging { cursor: grabbing; }
    .pick5-crop-stage img {
      position: absolute; top: 0; left: 0; transform-origin: 0 0;
      max-width: none; -webkit-user-drag: none; user-select: none; pointer-events: none;
    }
    .pick5-crop-zoom { width: 100%; margin: 18px 0 20px; accent-color: var(--md-sys-color-primary, #1d2d44); }
    .pick5-crop-actions { display: flex; justify-content: flex-end; gap: 10px; width: 100%; }
    .pick5-crop-actions button {
      padding: 10px 18px; border-radius: 999px; border: none;
      font-weight: 700; font-size: 14px; cursor: pointer; font-family: inherit;
      transition: background-color .15s ease;
    }
    .pick5-crop-cancel {
      background: var(--md-sys-color-secondary-container, #eee);
      color: var(--md-sys-color-on-secondary-container, #333);
    }
    .pick5-crop-cancel:hover { filter: brightness(0.95); }
    .pick5-crop-ok {
      background: var(--md-sys-color-primary, #1d2d44);
      color: var(--md-sys-color-on-primary, #fff);
    }
    .pick5-crop-ok:hover { filter: brightness(0.9); }
  `;
  document.head.appendChild(style);
}

/**
 * Shows a crop dialog for a just-selected image file. Resolves with a new
 * square File (same name, always image/png so transparency survives) once
 * the user confirms, or null if they cancel — callers should bail out on
 * null exactly like a cancelled native file picker.
 */
export function cropImage(file) {
  ensureStyles();
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Escape") cleanup(null);
    }
    document.addEventListener("keydown", onKey);

    const overlay = document.createElement("div");
    overlay.className = "pick5-crop-overlay";

    const box = document.createElement("div");
    box.className = "pick5-crop-box";

    const title = document.createElement("p");
    title.className = "pick5-crop-title";
    title.textContent = "Drag to reposition, scroll to zoom";
    box.appendChild(title);

    const stage = document.createElement("div");
    stage.className = "pick5-crop-stage";
    const img = document.createElement("img");
    img.src = objectUrl;
    stage.appendChild(img);
    box.appendChild(stage);

    const zoomSlider = document.createElement("input");
    zoomSlider.type = "range";
    zoomSlider.className = "pick5-crop-zoom";
    zoomSlider.min = "1";
    zoomSlider.max = "3";
    zoomSlider.step = "0.01";
    zoomSlider.value = "1";
    box.appendChild(zoomSlider);

    const actions = document.createElement("div");
    actions.className = "pick5-crop-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pick5-crop-cancel";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pick5-crop-ok";
    okBtn.textContent = "Use Photo";
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // baseScale is the "zoom = 1" fit — the smallest scale at which the
    // image still fully covers the circular stage (same idea as CSS
    // object-fit: cover), so the crop frame never shows empty space.
    let baseScale = 1;
    let scale = 1;
    let imgX = 0;
    let imgY = 0;

    function clamp() {
      const dispW = img.naturalWidth * scale;
      const dispH = img.naturalHeight * scale;
      const minX = STAGE_SIZE - dispW;
      const minY = STAGE_SIZE - dispH;
      imgX = Math.min(0, Math.max(minX, imgX));
      imgY = Math.min(0, Math.max(minY, imgY));
    }
    function applyTransform() {
      img.style.transform = `translate(${imgX}px, ${imgY}px) scale(${scale})`;
    }
    function setZoom(zoomFactor) {
      // Re-anchor on the stage's center so zooming feels like it's zooming
      // into the middle of the crop frame, not the image's top-left corner.
      const cx = STAGE_SIZE / 2;
      const cy = STAGE_SIZE / 2;
      const srcX = (cx - imgX) / scale;
      const srcY = (cy - imgY) / scale;
      scale = baseScale * zoomFactor;
      imgX = cx - srcX * scale;
      imgY = cy - srcY * scale;
      clamp();
      applyTransform();
    }

    img.onload = () => {
      baseScale = Math.max(STAGE_SIZE / img.naturalWidth, STAGE_SIZE / img.naturalHeight);
      scale = baseScale;
      imgX = (STAGE_SIZE - img.naturalWidth * scale) / 2;
      imgY = (STAGE_SIZE - img.naturalHeight * scale) / 2;
      applyTransform();
    };
    img.onerror = () => {
      showToast("Couldn't load that image.", "error");
      cleanup(null);
    };

    zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value)));

    // Pointer Events cover mouse + touch + pen with one code path.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    stage.addEventListener("pointerdown", (e) => {
      dragging = true;
      stage.classList.add("dragging");
      stage.setPointerCapture(e.pointerId);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    stage.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      imgX += e.clientX - lastX;
      imgY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      clamp();
      applyTransform();
    });
    function endDrag(e) {
      dragging = false;
      stage.classList.remove("dragging");
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomFactor = Math.min(3, Math.max(1, Number(zoomSlider.value) - e.deltaY * 0.002));
        zoomSlider.value = String(zoomFactor);
        setZoom(zoomFactor);
      },
      { passive: false }
    );

    cancelBtn.onclick = () => cleanup(null);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(null);
    });

    okBtn.onclick = () => {
      // Map the visible crop-frame square back to source-image pixel
      // coordinates, then rasterize just that region at a fixed output
      // size — same math as the on-screen transform, run in reverse.
      const sx = -imgX / scale;
      const sy = -imgY / scale;
      const sSize = STAGE_SIZE / scale;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      canvas.toBlob((blob) => {
        if (!blob) {
          showToast("Couldn't crop that image.", "error");
          cleanup(null);
          return;
        }
        const croppedName = file.name.replace(/\.[^.]+$/, "") + ".png";
        cleanup(new File([blob], croppedName, { type: "image/png" }));
      }, "image/png");
    };
  });
}
