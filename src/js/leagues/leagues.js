import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "../auth/firebase_init.js";
import { authedFetch } from "../util/api.js";
import { showToast } from "../util/toast.js";
import { showConfirm } from "../util/confirm-dialog.js";

const auth = getAuth(app);
// Absolute (not relative) so this resolves correctly regardless of how
// deeply nested the page loading this script is (e.g. /leagues.html vs
// /v1/leagues.html both need this to mean the same public/icons/ file).
const DEFAULT_AVATAR = "/icons/default_avatar.png";

document.addEventListener("DOMContentLoaded", () => {
  const userName = document.getElementById("user-name");
  const logoutBtn = document.getElementById("logout-btn");
  const editProfileBtn = document.getElementById("edit-profile-btn");
  const leaguesList = document.getElementById("leagues-list");
  const newLeagueBtn = document.getElementById("new-league-btn");
  const newLeaguePanel = document.getElementById("new-league-panel");
  const tabCreate = document.getElementById("tab-create");
  const tabJoin = document.getElementById("tab-join");
  const createForm = document.getElementById("create-league-form");
  const joinForm = document.getElementById("join-league-form");

  const howToPlayBtn = document.getElementById("how-to-play-btn");
  const howToPlayModal = document.getElementById("how-to-play-modal");
  const closeHowToPlay = document.getElementById("close-how-to-play");

  const editProfileModal = document.getElementById("edit-profile-modal");
  const closeEditProfile = document.getElementById("close-edit-profile");
  const editProfileForm = document.getElementById("edit-profile-form");
  const globalDisplayNameInput = document.getElementById("global-display-name");
  const globalPhotoUrlInput = document.getElementById("global-photo-url");

  const manageLeagueModal = document.getElementById("manage-league-modal");
  const closeManageLeague = document.getElementById("close-manage-league");
  const manageLeagueTitle = document.getElementById("manage-league-title");
  const manageLeagueNameInput = document.getElementById("manage-league-name");
  const manageLeaguePhotoInput = document.getElementById("manage-league-photo");
  const manageLeaguePhotoPreview = document.getElementById("manage-league-photo-preview");
  const saveLeagueNameBtn = document.getElementById("save-league-name-btn");
  const manageLeagueInviteCode = document.getElementById("manage-league-invite-code");
  const manageLeagueMembers = document.getElementById("manage-league-members");
  const transferOwnerSelect = document.getElementById("transfer-owner-select");
  const transferOwnerBtn = document.getElementById("transfer-owner-btn");
  const archiveLeagueBtn = document.getElementById("archive-league-btn");

  let currentManagedLeagueId = null;

  // Safety net: if onAuthStateChanged itself never fires (seen in the wild
  // during a Firebase Auth outage/rate-limit), the page would otherwise
  // hang forever on the static "..." placeholder with no feedback at all.
  // Give it a few seconds, then tell the user something's wrong instead of
  // silently doing nothing.
  // Shown by default in the page's own HTML (so it's visible the instant the
  // page itself has loaded, no JS required) and hidden once there's actually
  // something to look at — covers the "page sits blank/grey while auth and
  // the leagues list load over a slow connection" gap. Optional chaining
  // since /v1/leagues.html (shares this same script) has no such element.
  const pageLoadingOverlay = document.getElementById("page-loading-overlay");
  function hideLoadingOverlay() {
    pageLoadingOverlay?.classList.add("hidden");
  }

  let authResolved = false;
  const authTimeoutId = setTimeout(() => {
    if (authResolved) return;
    userName.textContent = "—";
    leaguesList.innerHTML = "<li class='no-leagues'>This is taking longer than usual. Hang tight, it may still finish loading, or refresh if nothing shows up soon.</li>";
    hideLoadingOverlay();
  }, 8000);

  // This page never itself signs anyone in (no login/signup form here), so a
  // persistent listener — unlike signup.html's — is correct: if the session
  // ever ends while on this page, kicking back to login is the right call.
  onAuthStateChanged(auth, async (user) => {
    authResolved = true;
    clearTimeout(authTimeoutId);
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    userName.textContent = user.displayName || user.email || "User";
    await loadLeagues();
    hideLoadingOverlay();
  });

  logoutBtn.onclick = async () => {
    await signOut(auth);
    window.location.href = "index.html";
  };

  // =========================
  // Leagues list
  // =========================
  async function loadLeagues() {
    let leagues;
    try {
      leagues = await authedFetch("/api/leagues/mine");
    } catch (err) {
      console.error("❌ Error loading leagues:", err);
      // Distinct from the real "you have zero leagues" state below — showing
      // "create or join one" here would be actively misleading to someone
      // who actually has leagues but just hit a failed/timed-out request.
      leaguesList.innerHTML = "<li class='no-leagues'>Trouble loading your leagues. Please refresh the page.</li>";
      return;
    }

    leaguesList.innerHTML = "";
    if (leagues.length === 0) {
      leaguesList.innerHTML = "<li class='no-leagues'>You are not in any leagues yet. Create or join one below.</li>";
      return;
    }

    const myUid = auth.currentUser?.uid;

    // Per-league display name + standings position both live in /scores
    // (already sorted by overall desc, and — since the submission-gating fix
    // — includes every member with a zero-default row even before they've
    // picked/submitted anything), so one fetch per league covers both.
    const withStanding = await Promise.all(
      leagues.map(async (league) => {
        try {
          const scores = await authedFetch(`/api/leagues/${league.id}/scores`);
          const myIndex = scores.findIndex((s) => s.uid === myUid);
          return {
            ...league,
            myDisplayName: myIndex >= 0 ? scores[myIndex].displayName : null,
            myRank: myIndex >= 0 ? myIndex + 1 : null,
            totalMembers: scores.length,
          };
        } catch (err) {
          console.error(`❌ Error loading standings for league ${league.id}:`, err);
          return { ...league, myDisplayName: null, myRank: null, totalMembers: null };
        }
      })
    );

    withStanding.forEach((league) => {
      const li = document.createElement("li");
      li.className = "league-row";

      const enterBtn = document.createElement("button");
      enterBtn.type = "button";
      enterBtn.className = "league-enter-btn";
      enterBtn.onclick = () => {
        localStorage.setItem("pick5_currentLeagueId", league.id);
        window.location.href = league.submitted ? "dashboard.html" : "picks.html";
      };

      const img = document.createElement("img");
      img.src = league.photoURL || DEFAULT_AVATAR;
      img.alt = league.name;
      img.className = "league-photo";
      enterBtn.appendChild(img);

      const info = document.createElement("div");
      info.className = "league-info";
      info.innerHTML = `
        <div class="league-name">${league.name}</div>
        <div class="league-my-name">${league.myDisplayName || "Unknown"}</div>
        <div class="league-my-position">${league.myRank && league.totalMembers ? `${league.myRank} of ${league.totalMembers}` : "—"}</div>
      `;
      enterBtn.appendChild(info);

      li.appendChild(enterBtn);

      if (league.role === "owner") {
        const gearBtn = document.createElement("button");
        gearBtn.type = "button";
        gearBtn.className = "league-gear-btn";
        gearBtn.textContent = "⚙";
        gearBtn.setAttribute("aria-label", `Manage ${league.name}`);
        gearBtn.onclick = (e) => {
          e.stopPropagation();
          openManageLeague(league.id);
        };
        li.appendChild(gearBtn);
      }

      leaguesList.appendChild(li);
    });
  }

  // =========================
  // New league panel (create/join)
  // =========================
  newLeagueBtn.onclick = () => newLeaguePanel.classList.toggle("hidden");

  tabCreate.onclick = () => {
    tabCreate.classList.add("active");
    tabJoin.classList.remove("active");
    createForm.classList.remove("hidden");
    joinForm.classList.add("hidden");
  };
  tabJoin.onclick = () => {
    tabJoin.classList.add("active");
    tabCreate.classList.remove("active");
    joinForm.classList.remove("hidden");
    createForm.classList.add("hidden");
  };

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("create-league-name");
    try {
      const league = await authedFetch("/api/leagues", {
        method: "POST",
        body: JSON.stringify({ name: nameInput.value.trim() }),
      });
      showToast(`League "${league.name}" created! Invite code: ${league.inviteCode}`, "success", 7000);
      nameInput.value = "";
      newLeaguePanel.classList.add("hidden");
      await loadLeagues();
    } catch (err) {
      showToast("Error creating league: " + err.message, "error");
    }
  });

  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const codeInput = document.getElementById("join-league-code");
    try {
      const league = await authedFetch("/api/leagues/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode: codeInput.value.trim() }),
      });
      showToast(`Joined "${league.name}"!`, "success");
      codeInput.value = "";
      newLeaguePanel.classList.add("hidden");
      await loadLeagues();
    } catch (err) {
      showToast("Error joining league: " + err.message, "error");
    }
  });

  // =========================
  // How to Play
  // =========================
  howToPlayBtn.onclick = () => howToPlayModal.classList.remove("hidden");
  closeHowToPlay.onclick = () => howToPlayModal.classList.add("hidden");

  // =========================
  // Global edit profile
  // =========================
  editProfileBtn.onclick = () => {
    const user = auth.currentUser;
    globalDisplayNameInput.value = user?.displayName || "";
    globalPhotoUrlInput.value = "";
    editProfileModal.classList.remove("hidden");
  };
  closeEditProfile.onclick = () => editProfileModal.classList.add("hidden");

  editProfileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const update = {};
      if (globalDisplayNameInput.value) update.displayName = globalDisplayNameInput.value;
      if (globalPhotoUrlInput.value) update.photoURL = globalPhotoUrlInput.value;
      await authedFetch("/api/profile", { method: "PATCH", body: JSON.stringify(update) });
      showToast("Profile updated!", "success");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      showToast("Error updating profile: " + err.message, "error");
    }
  });

  // =========================
  // Manage league (owner gear)
  // =========================
  async function openManageLeague(leagueId) {
    currentManagedLeagueId = leagueId;
    manageLeagueTitle.textContent = "Manage League";
    manageLeagueNameInput.value = "";
    manageLeaguePhotoInput.value = "";
    manageLeaguePhotoPreview.src = DEFAULT_AVATAR;
    manageLeagueInviteCode.textContent = "Loading...";
    manageLeagueMembers.innerHTML = "<li>Loading...</li>";
    transferOwnerSelect.innerHTML = "";
    manageLeagueModal.classList.remove("hidden");

    try {
      const league = await authedFetch(`/api/leagues/${leagueId}`);
      manageLeagueTitle.textContent = `Manage "${league.name}"`;
      manageLeagueNameInput.value = league.name;
      manageLeaguePhotoInput.value = league.photoURL || "";
      manageLeaguePhotoPreview.src = league.photoURL || DEFAULT_AVATAR;
      manageLeagueInviteCode.textContent = league.inviteCode;

      manageLeagueMembers.innerHTML = "";
      transferOwnerSelect.innerHTML = "";
      league.members.forEach((member) => {
        const li = document.createElement("li");
        li.className = "member-row";

        const img = document.createElement("img");
        img.src = member.photoURL || DEFAULT_AVATAR;
        img.alt = member.displayName || "Member";
        img.className = "member-avatar";
        li.appendChild(img);

        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${member.displayName || "Unknown"}${member.role === "owner" ? " (owner)" : ""}`;
        li.appendChild(nameSpan);

        if (member.role !== "owner") {
          const kickBtn = document.createElement("button");
          kickBtn.type = "button";
          kickBtn.textContent = "Kick";
          kickBtn.className = "kick-btn";
          kickBtn.onclick = async () => {
            const ok = await showConfirm(`Remove ${member.displayName} from this league?`, { confirmText: "Remove", danger: true });
            if (!ok) return;
            try {
              await authedFetch(`/api/leagues/${leagueId}/members/${member.uid}`, { method: "DELETE" });
              await openManageLeague(leagueId);
            } catch (err) {
              showToast("Error kicking member: " + err.message, "error");
            }
          };
          li.appendChild(kickBtn);

          const opt = document.createElement("option");
          opt.value = member.uid;
          opt.textContent = member.displayName || "Unknown";
          transferOwnerSelect.appendChild(opt);
        }

        manageLeagueMembers.appendChild(li);
      });

      if (transferOwnerSelect.options.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = "No other members yet";
        opt.disabled = true;
        transferOwnerSelect.appendChild(opt);
      }
    } catch (err) {
      manageLeagueMembers.innerHTML = `<li>Error loading league: ${err.message}</li>`;
    }
  }

  closeManageLeague.onclick = () => manageLeagueModal.classList.add("hidden");

  manageLeaguePhotoInput.addEventListener("input", () => {
    manageLeaguePhotoPreview.src = manageLeaguePhotoInput.value.trim() || DEFAULT_AVATAR;
  });
  manageLeaguePhotoPreview.onerror = () => {
    manageLeaguePhotoPreview.src = DEFAULT_AVATAR;
  };

  saveLeagueNameBtn.onclick = async () => {
    try {
      await authedFetch(`/api/leagues/${currentManagedLeagueId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: manageLeagueNameInput.value.trim(),
          photoURL: manageLeaguePhotoInput.value.trim() || null,
        }),
      });
      await loadLeagues();
      showToast("League updated!", "success");
    } catch (err) {
      showToast("Error updating league: " + err.message, "error");
    }
  };

  transferOwnerBtn.onclick = async () => {
    const newOwnerUid = transferOwnerSelect.value;
    if (!newOwnerUid) return;
    const ok = await showConfirm("Transfer ownership? You will no longer have owner permissions for this league.", { confirmText: "Transfer", danger: true });
    if (!ok) return;
    try {
      await authedFetch(`/api/leagues/${currentManagedLeagueId}/transfer-owner`, {
        method: "POST",
        body: JSON.stringify({ newOwnerUid }),
      });
      manageLeagueModal.classList.add("hidden");
      await loadLeagues();
      showToast("Ownership transferred!", "success");
    } catch (err) {
      showToast("Error transferring ownership: " + err.message, "error");
    }
  };

  archiveLeagueBtn.onclick = async () => {
    const ok = await showConfirm("Archive this league? It will disappear from everyone's league list, but no data is deleted.", { confirmText: "Archive", danger: true });
    if (!ok) return;
    try {
      await authedFetch(`/api/leagues/${currentManagedLeagueId}`, { method: "DELETE" });
      manageLeagueModal.classList.add("hidden");
      await loadLeagues();
      showToast("League archived.", "success");
    } catch (err) {
      showToast("Error archiving league: " + err.message, "error");
    }
  };

  window.addEventListener("click", (e) => {
    if (e.target === howToPlayModal) howToPlayModal.classList.add("hidden");
    if (e.target === editProfileModal) editProfileModal.classList.add("hidden");
    if (e.target === manageLeagueModal) manageLeagueModal.classList.add("hidden");
  });
});
