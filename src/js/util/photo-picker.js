// Shared "your photos" gallery widget — reused by both the global Edit
// Profile modal (leagues.html) and the per-league Settings modal
// (dashboard.html). Renders up to 3 uploaded-photo tiles, then any
// "linked" photos (pasted URLs the caller currently has set as their
// global photo or a per-league override, so they're quick to reuse), then
// an "add" tile — all backed by /api/profile/photos. Doesn't touch the
// plain paste-a-URL input that sits alongside it — that stays a fully
// independent option.
import { authedFetch } from "./api.js";
import { showToast } from "./toast.js";
import { showConfirm } from "./confirm-dialog.js";

const MAX_PHOTOS = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .photo-picker-grid { display: flex; gap: 10px; margin: 4px 0 6px; }
    .photo-picker-tile {
      position: relative; width: 64px; height: 64px; border-radius: var(--md-sys-shape-corner-md, 8px);
      overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; flex-shrink: 0;
      background: var(--md-sys-color-surface-container-highest, #eee);
    }
    .photo-picker-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .photo-picker-tile:hover { border-color: var(--md-sys-color-primary, #1976d2); }
    .photo-picker-tile.current { border-color: var(--brand-gold, #e9c400); }
    .photo-picker-remove {
      position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%;
      background: rgba(0,0,0,0.6); color: #fff; font-size: 12px; line-height: 18px; text-align: center;
      cursor: pointer;
    }
    .photo-picker-add {
      display: flex; align-items: center; justify-content: center; font-size: 26px; line-height: 1;
      color: var(--md-sys-color-on-surface-variant, #616161); border: 2px dashed var(--md-sys-color-outline-variant, #ccc);
      background: transparent;
    }
    .photo-picker-linked-badge {
      position: absolute; bottom: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: rgba(0,0,0,0.6); color: #fff; font-size: 9px; line-height: 16px; text-align: center;
    }
    .photo-picker-divider { width: 1px; align-self: stretch; background: var(--md-sys-color-outline-variant, #ccc); flex-shrink: 0; }
    .photo-picker-hint { font: var(--md-type-body-sm, 400 12px/16px sans-serif); color: var(--md-sys-color-on-surface-variant, #616161); margin: 0 0 12px; }
  `;
  document.head.appendChild(style);
}

/**
 * @param container element to render the gallery into (replaces its content)
 * @param onSelect  called with a photo's URL when the user picks one from
 *                  the gallery, or right after a successful upload
 * @param currentPhotoURL the photo currently in use in this context (global
 *                  profile or a specific league override) — its tile gets a
 *                  highlighted border so it's clear which one is active
 */
export async function initPhotoPicker(container, { onSelect, currentPhotoURL }) {
  ensureStyles();
  container.innerHTML = `<p class="photo-picker-hint">Loading your photos...</p>`;

  let photos = [];
  let linkedPhotos = [];
  try {
    const data = await authedFetch("/api/profile/photos");
    photos = data.uploadedPhotos || [];
    linkedPhotos = data.linkedPhotos || [];
  } catch (err) {
    container.innerHTML = `<p class="photo-picker-hint">Couldn't load your photos: ${err.message}</p>`;
    return;
  }

  render();

  function render() {
    const grid = document.createElement("div");
    grid.className = "photo-picker-grid";

    photos.forEach((photo) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "photo-picker-tile" + (photo.url === currentPhotoURL ? " current" : "");
      tile.innerHTML = `<img src="${photo.url}" alt="Uploaded photo"><span class="photo-picker-remove" title="Remove">&times;</span>`;
      tile.onclick = (e) => {
        if (e.target.closest(".photo-picker-remove")) return;
        onSelect(photo.url);
      };
      tile.querySelector(".photo-picker-remove").onclick = async (e) => {
        e.stopPropagation();
        const ok = await showConfirm("Remove this photo? You'll need to re-upload it to use it again.", { confirmText: "Remove", danger: true });
        if (!ok) return;
        try {
          const data = await authedFetch(`/api/profile/photos/${photo.id}`, { method: "DELETE" });
          photos = data.uploadedPhotos || [];
          linkedPhotos = data.linkedPhotos || linkedPhotos;
          render();
          showToast("Photo removed.", "success");
        } catch (err) {
          showToast("Error removing photo: " + err.message, "error");
        }
      };
      grid.appendChild(tile);
    });

    // Photos currently linked (pasted URL) somewhere — your global photo or
    // a per-league override — surfaced as quick-pick tiles too, distinct
    // from uploads via a small badge since there's nothing here to delete
    // (nothing's stored server-side for these, they're just references).
    if (linkedPhotos.length && photos.length) {
      const divider = document.createElement("div");
      divider.className = "photo-picker-divider";
      grid.appendChild(divider);
    }
    linkedPhotos.forEach((photo) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "photo-picker-tile" + (photo.url === currentPhotoURL ? " current" : "");
      tile.title = "Linked photo currently in use";
      tile.innerHTML = `<img src="${photo.url}" alt="Linked photo"><span class="photo-picker-linked-badge" title="Linked, not uploaded">&#128279;</span>`;
      tile.onclick = async () => {
        onSelect(photo.url);
        // This list only reflects what's *currently* active somewhere — if
        // they switch away from it, it'll vanish next time the picker
        // loads, unlike an uploaded photo. Automatically keep it as a real
        // slot instead, same as a real upload would be, rather than asking
        // — silently a no-op once the gallery is full (photos.length check).
        if (photos.length >= MAX_PHOTOS) return;
        try {
          const data = await authedFetch("/api/profile/photos/link", { method: "POST", body: JSON.stringify({ url: photo.url }) });
          photos = data.uploadedPhotos || photos;
          linkedPhotos = linkedPhotos.filter((p) => p.url !== photo.url);
          render();
          showToast("Saved to your gallery.", "success");
        } catch (err) {
          showToast("Error saving photo: " + err.message, "error");
        }
      };
      grid.appendChild(tile);
    });

    if (photos.length < MAX_PHOTOS) {
      const addTile = document.createElement("label");
      addTile.className = "photo-picker-tile photo-picker-add";
      addTile.innerHTML = `<span>+</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>`;
      addTile.querySelector("input").onchange = async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
          showToast("That photo is too large — 5MB max.", "error");
          return;
        }
        try {
          const formData = new FormData();
          formData.append("photo", file);
          const data = await authedFetch("/api/profile/photos", { method: "POST", body: formData });
          photos = data.uploadedPhotos || [];
          render();
          const uploaded = photos[photos.length - 1];
          if (uploaded) onSelect(uploaded.url);
          showToast("Photo uploaded!", "success");
        } catch (err) {
          showToast("Error uploading photo: " + err.message, "error");
        }
      };
      grid.appendChild(addTile);
    }

    const hint = document.createElement("p");
    hint.className = "photo-picker-hint";
    hint.textContent = photos.length >= MAX_PHOTOS
      ? "You have 3 photos stored — remove one to upload a new one."
      : "Click a photo to use it, or add a new one. PNG, JPG, WEBP, or GIF, up to 5MB.";

    container.innerHTML = "";
    container.append(grid, hint);
  }
}
