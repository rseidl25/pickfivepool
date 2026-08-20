// =========================
// State
// =========================
let currentWeek = 1;
let picks = [];
let bonusPick = null;
let gameData = [];
let gameTimes = [];
let gameDates = [];
let weekStatuses = {};
let currentLeagueId = null;

// Autosave used to fire an un-awaited PUT on every single pick click — rapid
// clicking (or a fast test script) could have several overlapping in-flight
// requests for the same week in the air at once, with no guarantee the last
// one to finish is the one carrying the latest state, risking an older save
// clobbering newer picks. Debouncing collapses a burst of clicks into one
// save of the final state; flushPendingAutosaves() forces any still-pending
// save through immediately at points where losing it would matter (final
// submit, tab close).
const autosaveTimers = {};
const pendingAutosaves = {};
const AUTOSAVE_DEBOUNCE_MS = 500;

function scheduleAutosave(leagueId, week, state) {
  clearTimeout(autosaveTimers[week]);
  pendingAutosaves[week] = { leagueId, state };
  autosaveTimers[week] = setTimeout(() => {
    delete autosaveTimers[week];
    delete pendingAutosaves[week];
    autosaveWeekPicks(leagueId, week, state);
  }, AUTOSAVE_DEBOUNCE_MS);
}

function flushPendingAutosaves() {
  const saves = Object.entries(pendingAutosaves).map(([week, { leagueId, state }]) => {
    clearTimeout(autosaveTimers[week]);
    delete autosaveTimers[week];
    delete pendingAutosaves[week];
    return autosaveWeekPicks(leagueId, week, state);
  });
  return Promise.all(saves);
}

// =========================
// Elements
// =========================
const matchupsDiv = document.getElementById("matchups");
const picksList = document.getElementById("picks-list");
const weekTitle = document.getElementById("week-title");
const weekNav = document.getElementById("week-nav");
const submitBtn = document.getElementById("submit-btn");
const summaryScreen = document.getElementById("summary-screen");
const summaryContent = document.getElementById("summary-content");
const backBtn = document.getElementById("back-btn");
const finalSubmitBtn = document.getElementById("final-submit-btn");
const mainContent = document.getElementById("main-content");
const weekNavContainer = document.getElementById("week-nav-container");
const leaguePlayerRow = document.getElementById("league-player-row");
const summaryActions = document.getElementById("summary-actions");
const topLeagueName = document.getElementById("top-league-name");
const topUserDisplay = document.getElementById("top-user-display");

// Mobile-only controls (bet-slip-style bottom drawer). Does nothing on
// desktop — the CSS behind it only applies under the mobile breakpoint — so
// it's safe to wire up unconditionally here.
const picksBottomBar = document.getElementById("picks-bottom-bar");
const picksBottomSummary = document.getElementById("picks-bottom-summary");
const picksDrawerBackdrop = document.getElementById("picks-drawer-backdrop");
const sidebar = document.querySelector(".sidebar");

function openPicksDrawer() {
  sidebar.classList.add("open");
  picksBottomBar.classList.add("open");
  picksDrawerBackdrop.classList.add("visible");
}
function closePicksDrawer() {
  sidebar.classList.remove("open");
  picksBottomBar.classList.remove("open");
  picksDrawerBackdrop.classList.remove("visible");
}
picksBottomBar.addEventListener("click", () => {
  sidebar.classList.contains("open") ? closePicksDrawer() : openPicksDrawer();
});
picksDrawerBackdrop.addEventListener("click", closePicksDrawer);

// =========================
// Logos
// =========================
const teamLogoMap = {
  "49ers": "49ers.png",
  "Bears": "bears.png",
  "Bengals": "bengals.png",
  "Bills": "bills.png",
  "Broncos": "broncos.png",
  "Browns": "browns.png",
  "Buccaneers": "buccaneers.png",
  "Cardinals": "cardinals.png",
  "Chargers": "chargers.png",
  "Chiefs": "chiefs.png",
  "Colts": "colts.png",
  "Commanders": "commanders.png",
  "Cowboys": "cowboys.png",
  "Dolphins": "dolphins.png",
  "Eagles": "eagles.png",
  "Falcons": "falcons.png",
  "Giants": "giants.png",
  "Jaguars": "jaguars.png",
  "Jets": "jets.png",
  "Lions": "lions.png",
  "Packers": "packers.png",
  "Panthers": "panthers.png",
  "Patriots": "patriots.png",
  "Raiders": "raiders.png",
  "Rams": "rams.png",
  "Ravens": "ravens.png",
  "Saints": "saints.png",
  "Seahawks": "seahawks.png",
  "Steelers": "steelers.png",
  "Texans": "texans.png",
  "Titans": "titans.png",
  "Vikings": "vikings.png",
};

function getLogoPath(teamName) {
  const key = teamName.split(" ").pop();
  return `/logos/${teamLogoMap[key] || ""}`;
}

// =========================
// Helpers
// =========================
// Same approach as the dashboard's "Last Updated" timestamp: the schedule
// stores a plain ISO timestamp (gameTimeISO), and each viewer's own browser
// formats it in their own local timezone — Pacific and Central players
// shouldn't both see the same fixed-zone time.
function formatLocalGameTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(isoString));
}

function formatDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  const m = parseInt(yyyymmdd.substring(4, 6), 10);
  const d = parseInt(yyyymmdd.substring(6, 8), 10);
  return `${m}/${d}`;
}

// =========================
// Data loading
// =========================
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getMyPicks, autosaveWeekPicks, submitPicks } from "../picks/picks_firebase.js";
import { authedFetch } from "../util/api.js";
import { showToast } from "../util/toast.js";
import { showConfirm } from "../util/confirm-dialog.js";

const auth = getAuth();

// Converts the server's { week1: { teamsPicked, bonusPick }, ... } shape into
// the { 1: { picks, bonus }, ... } shape the rest of this file already uses.
function toWeekStatuses(serverPicks) {
  const result = {};
  for (const [weekKey, data] of Object.entries(serverPicks)) {
    const weekNum = parseInt(weekKey.replace("week", ""), 10);
    result[weekNum] = {
      picks: (data.teamsPicked || []).map((p) => ({ team: p.team, matchup: p.matchup })),
      bonus: data.bonusPick || null,
    };
  }
  return result;
}

async function loadGameData() {
  try {
    const [gamesRes, timesRes, datesRes] = await Promise.all([
      fetch("/api/games"),
      fetch("../src/data/game/times.json"),
      fetch("../src/data/game/dates.json"),
    ]);

    gameData = await gamesRes.json();
    gameTimes = await timesRes.json();
    gameDates = await datesRes.json();

    const serverPicks = await getMyPicks(currentLeagueId);
    weekStatuses = toWeekStatuses(serverPicks);

    renderWeek(currentWeek);
    renderWeekNav();
    updateSubmitButton();
  } catch (err) {
    console.error("Error loading game data:", err);
    matchupsDiv.innerHTML = "<p>⚠️ Could not load game data.</p>";
  }
}

// =========================
// Render Week
// =========================
function renderWeek(weekNumber) {
  weekTitle.textContent = `WEEK ${weekNumber}`;

  if (!weekStatuses[weekNumber]) {
    weekStatuses[weekNumber] = { picks: [], bonus: null };
  }
  picks = weekStatuses[weekNumber].picks.map(p => ({
    team: p.team,
    matchup: p.matchup || `week${weekNumber}`  // ensure matchup exists
  }));
  bonusPick = weekStatuses[weekNumber].bonus;

  renderPicks();

  const weekObj = gameData.find((w) => w.week === weekNumber);
  if (!weekObj) {
    matchupsDiv.innerHTML = "<p>No games found for this week.</p>";
    return;
  }

  matchupsDiv.innerHTML = "";

  const gamesByDay = {};
  weekObj.games.forEach((game, idx) => {
    if (!gamesByDay[game.weekday]) gamesByDay[game.weekday] = [];
    gamesByDay[game.weekday].push({ game, idx });
  });

  const weekDateObj = gameDates.find((gd) => gd.week === weekNumber);

  for (const [day, games] of Object.entries(gamesByDay)) {
    const dayContainer = document.createElement("div");
    dayContainer.className = "weekday-container";

    const headerRow = document.createElement("div");
    headerRow.className = "weekday-header-row";

    const dayHeader = document.createElement("div");
    dayHeader.className = "weekday-header";

    let dateText = "";
    if (weekDateObj && weekDateObj[day.toLowerCase()]) {
      dateText = ` (${formatDate(weekDateObj[day.toLowerCase()])})`;
    }
    dayHeader.textContent = day + dateText;

    const timeHeader = document.createElement("div");
    timeHeader.className = "game-time-header";
    timeHeader.textContent = "Time (CST)";

    // Mobile-only accordion toggle (desktop's CSS never hides .matchup-row,
    // so this chevron/click just has no visible effect there).
    const chevron = document.createElement("span");
    chevron.className = "weekday-chevron";
    chevron.textContent = "▾";
    headerRow.addEventListener("click", () => {
      dayContainer.classList.toggle("collapsed");
    });

    headerRow.appendChild(dayHeader);
    headerRow.appendChild(timeHeader);
    headerRow.appendChild(chevron);
    dayContainer.appendChild(headerRow);

    games.forEach(({ game, idx }) => {
      const row = document.createElement("div");
      row.className = "matchup-row";
      const matchupKey = `week${weekNumber}_game${idx}`;

      const weekTimes = gameTimes.find((w) => w.week === weekNumber);
      let gameTime = "";
      let note = "";
      if (weekTimes) {
        const match = weekTimes.games.find(
          (g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam
        );
        if (match) {
          // Fall back to the pre-formatted (Eastern-time) string if an old
          // cached times.json without gameTimeISO ever slips through.
          gameTime = match.gameTimeISO ? formatLocalGameTime(match.gameTimeISO) : match.gameTime || "";
          note = match.note || "";
        }
      }

      const timeDiv = document.createElement("div");
      timeDiv.className = "game-time";
      timeDiv.textContent = gameTime;
      row.appendChild(timeDiv);

      const centerCol = document.createElement("div");
      centerCol.className = "center-col";

      const away = createTeamBox(game.awayTeam, game.homeTeam, matchupKey);
      const at = document.createElement("div");
      at.className = "at-label";
      at.textContent = "at";

      const homeContainer = document.createElement("div");
      homeContainer.className = "home-container";
      const home = createTeamBox(game.homeTeam, game.awayTeam, matchupKey);
      homeContainer.appendChild(home);

      if (note && note.toLowerCase() !== "none") {
        const noteDiv = document.createElement("div");
        noteDiv.className = "game-note";
        noteDiv.textContent = note;
        homeContainer.appendChild(noteDiv);
      }

      centerCol.appendChild(away);
      centerCol.appendChild(at);
      centerCol.appendChild(homeContainer);

      row.appendChild(centerCol);
      dayContainer.appendChild(row);
    });

    matchupsDiv.appendChild(dayContainer);
  }

  fitTeamBoxLabels();
}

// Long team names (e.g. "Tampa Bay Buccaneers") shrink to fit on one line
// first. If even the smallest readable size still doesn't fit, the name
// wraps onto a second line rather than getting cut off with an ellipsis —
// .team-box/.home-container's flex:1 1 0 and .center-col's align-items:
// stretch (see picks.css) mean the *other* box in that matchup still grows
// to match, and .at-label centers itself regardless of the resulting
// height, so a two-line name never throws off the "at" alignment.
// Shrinks an element's own font-size (in place) until its text fits within
// its current box width, down to minFontSize. Assumes the element already
// has white-space:nowrap so scrollWidth reflects the single-line width.
function shrinkFontToFit(label, minFontSize) {
  const maxFontSize = parseFloat(getComputedStyle(label).fontSize);
  let fontSize = maxFontSize;
  label.style.fontSize = "";
  while (label.scrollWidth > label.clientWidth && fontSize > minFontSize) {
    fontSize -= 0.5;
    label.style.fontSize = `${fontSize}px`;
  }
}

const TEAM_LABEL_MIN_FONT_PX = 10;
function fitTeamBoxLabels() {
  document.querySelectorAll(".team-box span").forEach((label) => {
    label.style.whiteSpace = "nowrap";
    shrinkFontToFit(label, TEAM_LABEL_MIN_FONT_PX);
    if (label.scrollWidth > label.clientWidth) {
      label.style.whiteSpace = "normal";
    }
  });
}

// League name / player display name above the picks container — always
// stays on one line, shrinking as needed rather than wrapping.
const HEADER_LABEL_MIN_FONT_PX = 10;
function fitHeaderLabels() {
  [topLeagueName, topUserDisplay].forEach((label) => shrinkFontToFit(label, HEADER_LABEL_MIN_FONT_PX));
}

// =========================
// Week Nav Rendering
// =========================
function renderWeekNav() {
  weekNav.innerHTML = "";

  for (let w = 1; w <= 18; w++) {
    const btn = document.createElement("button");
    btn.className = "week-btn";
    btn.textContent = w;

    const status = getWeekStatus(w);
    btn.classList.add(status);
    if (w === currentWeek) btn.classList.add("active");

    btn.addEventListener("click", () => {
      currentWeek = w;
      renderWeek(currentWeek);
    });

    weekNav.appendChild(btn);
  }
}

// =========================
// Week Status
// =========================
function getWeekStatus(week) {
  const state = weekStatuses[week];
  if (!state || state.picks.length === 0) return "status-grey";

  const allBonus = Object.values(weekStatuses)
    .map((s) => s?.bonus)
    .filter(Boolean);
  const duplicates = allBonus.filter((b, i, arr) => arr.indexOf(b) !== i);

  if (state.bonus && duplicates.includes(state.bonus)) return "status-red";
  if (state.picks.length < 5 || !state.bonus) return "status-yellow";
  return "status-green";
}

// =========================
// Create Team Box
// =========================
function createTeamBox(team, opponent, matchupKey) {
  const box = document.createElement("div");
  box.className = "team-box";
  box.dataset.team = team;
  box.dataset.matchup = matchupKey;

  const logo = document.createElement("img");
  logo.src = getLogoPath(team);
  logo.alt = `${team} logo`;
  logo.className = "team-logo";

  const label = document.createElement("span");
  label.textContent = team;
  label.style.fontWeight = "bold";

  box.appendChild(logo);
  box.appendChild(label);

  if (picks.find((p) => p.team === team && p.matchup === matchupKey)) {
    box.classList.add("selected");
  }

  box.addEventListener("click", () =>
    toggleTeam(team, opponent, "Scheduled", box, matchupKey)
  );

  return box;
}

// =========================
// Toggle Team
// =========================
function toggleTeam(team, opponent, status, element, matchupKey) {
  const existingPick = picks.find((p) => p.matchup === matchupKey);

  if (existingPick && existingPick.team === team) {
    picks = picks.filter((p) => p.team !== team);
    element.classList.remove("selected");
    if (bonusPick === team) bonusPick = null;
    renderPicks();
    return;
  }

  if (existingPick && existingPick.team !== team) {
    picks = picks.filter((p) => p.matchup !== matchupKey);
    const oldTeam = existingPick.team;
    const oldEl = document.querySelector(
      `.team-box[data-team="${oldTeam}"][data-matchup="${matchupKey}"]`
    );
    if (oldEl) oldEl.classList.remove("selected");
    if (bonusPick === oldTeam) bonusPick = null;
  }

  if (picks.length >= 5) {
    showToast("You already picked 5 teams!", "error");
    return;
  }

  picks.push({ team, matchup: matchupKey });
  element.classList.add("selected");
  renderPicks();

  // Completing the 5th pick is exactly when a player needs to see the
  // picks drawer — to set their bonus pick — so open it automatically
  // instead of making them notice and tap the bar themselves.
  if (picks.length === 5) openPicksDrawer();
}

// =========================
// Render Picks
// =========================
function renderPicks() {
  picksList.innerHTML = "";

  picks.forEach((p) => {
    const wrapper = document.createElement("div");
    wrapper.className = "pick-box";

    const logo = document.createElement("img");
    logo.src = getLogoPath(p.team);
    logo.alt = `${p.team} logo`;
    logo.className = "pick-logo";

    const label = document.createElement("span");
    label.textContent = p.team;
    label.className = "pick-label";
    label.style.fontWeight = "bold";

    if (p.team === bonusPick) wrapper.classList.add("bonus");

    wrapper.addEventListener("click", () => {
      bonusPick = bonusPick === p.team ? null : p.team;
      renderPicks();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "pick-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${p.team}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removePick(p);
    });

    wrapper.appendChild(logo);
    wrapper.appendChild(label);
    wrapper.appendChild(removeBtn);
    picksList.appendChild(wrapper);
  });

  document.querySelector("#picks-box h2").textContent = `Your Picks (${picks.length}/5)`;
  document.getElementById("picks-progress-fill").style.width = `${(picks.length / 5) * 100}%`;
  picksBottomSummary.textContent = `🏈 Your Picks: ${picks.length}/5${bonusPick ? " · Bonus set" : ""}`;

  weekStatuses[currentWeek] = { picks: [...picks], bonus: bonusPick };
  renderWeekNav();
  renderBonusTracker();
  updateSubmitButton();

  if (auth.currentUser && currentLeagueId) {
    scheduleAutosave(currentLeagueId, currentWeek, weekStatuses[currentWeek]);
  }
}

// =========================
// Remove Pick
// =========================
function removePick(pick) {
  if (bonusPick === pick.team) bonusPick = null;
  picks = picks.filter((x) => !(x.team === pick.team && x.matchup === pick.matchup));
  const teamBox = document.querySelector(
    `.team-box[data-team="${pick.team}"][data-matchup="${pick.matchup}"]`
  );
  if (teamBox) teamBox.classList.remove("selected");
  renderPicks();
}

// =========================
// Bonus Tracker
// =========================
function renderBonusTracker() {
  const tracker = document.getElementById("bonus-tracker");
  tracker.innerHTML = "<h2>Bonus Tracker</h2>";

  const container = document.createElement("div");
  container.className = "bonus-grid";

  const allBonus = {};
  for (let w = 1; w <= 18; w++) {
    const b = weekStatuses[w]?.bonus;
    if (b) {
      if (!allBonus[b]) allBonus[b] = [];
      allBonus[b].push(w);
    }
  }

  for (let col = 0; col < 2; col++) {
    const colDiv = document.createElement("div");
    colDiv.className = "bonus-col";

    const start = col === 0 ? 1 : 10;
    const end = col === 0 ? 9 : 18;

    for (let w = start; w <= end; w++) {
      const row = document.createElement("div");
      row.className = "bonus-row";

      const bonusTeam = weekStatuses[w]?.bonus;

      if (bonusTeam && allBonus[bonusTeam]?.length > 1) {
        const alertImg = document.createElement("img");
        alertImg.src = "../icons/alert.png";
        alertImg.alt = "Duplicate bonus";
        alertImg.className = "bonus-alert";
        row.appendChild(alertImg);
      }

      if (bonusTeam && bonusTeam !== "") {
        const logo = document.createElement("img");
        logo.src = getLogoPath(bonusTeam);
        logo.alt = `${bonusTeam} logo`;
        logo.className = "bonus-team-logo";
        row.appendChild(logo);
      }

      const label = document.createElement("span");
      label.textContent = `WEEK ${w}: ${bonusTeam || ""}`;
      if (bonusTeam && allBonus[bonusTeam]?.length > 1) {
        label.classList.add("bonus-duplicate");
      }
      row.appendChild(label);

      colDiv.appendChild(row);
    }

    container.appendChild(colDiv);
  }

  tracker.appendChild(container);
}

// =========================
// Submit / Next Button Logic
// =========================
function updateSubmitButton() {
  let allValid = true;

  for (let w = 1; w <= 18; w++) {
    const state = weekStatuses[w];
    if (!state || state.picks.length < 5 || !state.bonus) {
      allValid = false;
      break;
    }
  }

  const allBonus = Object.values(weekStatuses).map(s => s?.bonus).filter(Boolean);
  const duplicates = allBonus.filter((b, i, arr) => arr.indexOf(b) !== i);
  if (duplicates.length > 0) allValid = false;

  if (allValid) {
    submitBtn.disabled = false;
    submitBtn.classList.add("enabled");
  } else {
    submitBtn.disabled = true;
    submitBtn.classList.remove("enabled");
  }
}

// =========================
// Summary Screen
// =========================
function renderSummary() {
  summaryContent.innerHTML = "";

  for (let w = 1; w <= 18; w++) {
    const state = weekStatuses[w];
    const div = document.createElement("div");

    const pickCount = state?.picks?.length || 0;
    const hasBonus = !!state?.bonus;
    const isComplete = pickCount === 5 && hasBonus;
    div.className = isComplete ? "summary-week" : "summary-week incomplete";

    const header = `<h3><span>Week ${w}</span>${isComplete ? "" : `<span class="summary-week-flag">⚠ ${pickCount}/5${hasBonus ? "" : ", no bonus"}</span>`}</h3>`;

    if (pickCount === 0) {
      div.innerHTML = `${header}<p>No picks made.</p>`;
    } else {
      // Sort so bonus pick always comes first
      const sortedPicks = [...state.picks].sort((a, b) => {
        if (a.team === state.bonus) return -1;
        if (b.team === state.bonus) return 1;
        return 0;
      });

      let picksHTML = sortedPicks
        .map((p) => {
          // Find game info for opponent
          const weekObj = gameData.find((wk) => wk.week === w);
          const game = weekObj?.games.find(
            (g) => g.homeTeam === p.team || g.awayTeam === p.team
          );

          let opponent = "Opponent";
          let matchup = "";
          let dayTimeText = "";
          if (game) {
            if (game.homeTeam === p.team) {
              opponent = game.awayTeam;
              matchup = `<strong>${p.team}</strong> vs. ${opponent}`;
            } else {
              opponent = game.homeTeam;
              matchup = `<strong>${p.team}</strong> @ ${opponent}`;
            }

            // Same day/time lookup used on the main picks list — real ISO
            // timestamp formatted in the viewer's own local timezone.
            const weekTimes = gameTimes.find((wt) => wt.week === w);
            const timeMatch = weekTimes?.games.find(
              (g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam
            );
            const timeText = timeMatch?.gameTimeISO
              ? formatLocalGameTime(timeMatch.gameTimeISO)
              : timeMatch?.gameTime || "";
            dayTimeText = [game.weekday, timeText].filter(Boolean).join(" · ");
          }

          const logo = `<img src="${getLogoPath(p.team)}" class="pick-logo">`;
          const liClass = p.team === state.bonus ? "summary-bonus" : "";

          return `<li class="${liClass}">
            ${logo}
            <span class="summary-pick-info">
              <span class="summary-pick-matchup">${matchup}</span>
              ${dayTimeText ? `<span class="summary-pick-time">${dayTimeText}</span>` : ""}
            </span>
          </li>`;
        })
        .join("");

      div.innerHTML = `${header}<ul>${picksHTML}</ul>`;
    }

    summaryContent.appendChild(div);
  }
}

// =========================
// Button Events
// =========================
submitBtn.addEventListener("click", () => {
  if (!submitBtn.disabled) {
    mainContent.style.display = "none";
    weekNavContainer.style.display = "none";
    leaguePlayerRow.style.display = "none";
    // The mobile bet-slip bar/drawer are separate fixed-position elements,
    // not inside #main-content, so hiding that alone doesn't hide them —
    // and the summary screen doesn't need a "your picks" shortcut anyway,
    // it *is* your picks.
    closePicksDrawer();
    picksBottomBar.style.display = "none";
    summaryScreen.style.display = "block";
    summaryActions.style.display = "flex";
    renderSummary();
  }
});

// Best-effort: push through any debounced save still waiting if the tab
// closes before its 500ms timer would otherwise have fired.
window.addEventListener("beforeunload", () => {
  flushPendingAutosaves();
});

backBtn.addEventListener("click", () => {
  summaryScreen.style.display = "none";
  summaryActions.style.display = "none";
  mainContent.style.display = "flex";
  weekNavContainer.style.display = "flex";
  leaguePlayerRow.style.display = "flex";
  // Clear the inline override rather than forcing a value — #picks-bottom-bar
  // is display:none on desktop and display:flex on mobile via CSS, so let
  // the stylesheet decide again instead of hardcoding one or the other.
  picksBottomBar.style.display = "";
});

finalSubmitBtn.addEventListener("click", async () => {
  const confirmSubmit = await showConfirm(
    "Are you sure you want to submit?\n\nOnce you submit, you will NOT be able to change your picks for the entire season.",
    { confirmText: "Submit", danger: true }
  );
  if (!confirmSubmit) return;

  try {
    await flushPendingAutosaves();
    await submitPicks(currentLeagueId);
    showToast("Your picks have been submitted and locked for the season!", "success");
    setTimeout(() => (window.location.href = "dashboard.html"), 1000);
  } catch (err) {
    console.error("❌ Error submitting:", err);
    showToast("Error while submitting: " + err.message, "error");
  }
});

// =========================
// Init with Auth Listener
// =========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    console.log("👤 Not logged in — the page's auth guard will redirect to login.");
    return;
  }

  currentLeagueId = localStorage.getItem("pick5_currentLeagueId");
  if (!currentLeagueId) {
    matchupsDiv.innerHTML = "<p>⚠️ No league selected. Head back to the dashboard and pick a league first.</p>";
    return;
  }

  console.log("🔑 Logged in as:", user.uid, "league:", currentLeagueId);
  loadLeagueHeaderInfo(user.uid); // independent of picks/game data — don't block on it
  await loadGameData();
});

// League name + this member's per-league display name, shown centered above
// the week title — matches the per-league identity shown elsewhere in the
// app (e.g. dashboard.html's header) rather than the global account name.
async function loadLeagueHeaderInfo(uid) {
  try {
    const league = await authedFetch(`/api/leagues/${currentLeagueId}`);
    topLeagueName.textContent = league.name;
    const me = league.members?.find((m) => m.uid === uid);
    topUserDisplay.textContent = me?.displayName || "";
    fitHeaderLabels();
  } catch (err) {
    console.error("❌ Error loading league header info:", err);
  }
}
