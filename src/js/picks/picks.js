// Picks controller (autosave debouncing, week-status coloring, summary
// generation). The old picks page lives on at src/js/v1/picks.js.

let currentWeek = 1;
let picks = [];
let bonusPick = null;
let gameData = [];
let gameTimes = [];
let gameDates = [];
let weekStatuses = {};
let currentLeagueId = null;

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
const weekSelectRow = document.getElementById("week-select-row");
const weekTitleEl = document.getElementById("week-title");
const summaryActions = document.getElementById("summary-actions");
const topLeagueName = document.getElementById("top-league-name");
const topUserDisplay = document.getElementById("top-user-display");

const copyPicksModal = document.getElementById("copy-picks-modal");
const copyPicksLeagueList = document.getElementById("copy-picks-league-list");
const copyPicksSkipBtn = document.getElementById("copy-picks-skip-btn");
const copyPicksConfirmBtn = document.getElementById("copy-picks-confirm-btn");

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
  "49ers": "49ers.png", Bears: "bears.png", Bengals: "bengals.png", Bills: "bills.png",
  Broncos: "broncos.png", Browns: "browns.png", Buccaneers: "buccaneers.png", Cardinals: "cardinals.png",
  Chargers: "chargers.png", Chiefs: "chiefs.png", Colts: "colts.png", Commanders: "commanders.png",
  Cowboys: "cowboys.png", Dolphins: "dolphins.png", Eagles: "eagles.png", Falcons: "falcons.png",
  Giants: "giants.png", Jaguars: "jaguars.png", Jets: "jets.png", Lions: "lions.png",
  Packers: "packers.png", Panthers: "panthers.png", Patriots: "patriots.png", Raiders: "raiders.png",
  Rams: "rams.png", Ravens: "ravens.png", Saints: "saints.png", Seahawks: "seahawks.png",
  Steelers: "steelers.png", Texans: "texans.png", Titans: "titans.png", Vikings: "vikings.png",
};
function getLogoPath(teamName) {
  const key = teamName.split(" ").pop();
  return `/logos/${teamLogoMap[key] || ""}`;
}

// =========================
// Helpers
// =========================
function formatLocalGameTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
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
import { getMyPicks, autosaveWeekPicks, submitPicks } from "./picks_firebase.js";
import { authedFetch } from "../util/api.js";
import { showToast } from "../util/toast.js";
import { showConfirm } from "../util/confirm-dialog.js";

const auth = getAuth();

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
  // Split into two independent try/catches — the schedule (public, no auth
  // needed) and the user's picks (authenticated) fail for very different
  // reasons. Lumping them together meant any picks/auth hiccup showed
  // "Could not load game data" even when the schedule loaded fine, which
  // was both misleading and needlessly blocked the whole page.
  try {
    const [gamesRes, timesRes, datesRes] = await Promise.all([
      fetch("/api/games"),
      fetch("/src/data/game/times.json"),
      fetch("/src/data/game/dates.json"),
    ]);

    gameData = await gamesRes.json();
    gameTimes = await timesRes.json();
    gameDates = await datesRes.json();
  } catch (err) {
    console.error("Error loading game schedule:", err);
    matchupsDiv.innerHTML = "<p>⚠️ Could not load game data. Try refreshing the page.</p>";
    return;
  }

  try {
    const serverPicks = await getMyPicks(currentLeagueId);
    weekStatuses = toWeekStatuses(serverPicks);
  } catch (err) {
    console.error("Error loading your picks:", err);
    showToast("Couldn't load your saved picks — try refreshing the page.", "error");
    weekStatuses = {};
  }

  renderWeek(currentWeek);
  renderWeekNav();
  updateSubmitButton();
}

// =========================
// Render Week
// =========================
function renderWeek(weekNumber) {
  weekTitle.textContent = `WEEK ${weekNumber}`;

  if (!weekStatuses[weekNumber]) weekStatuses[weekNumber] = { picks: [], bonus: null };
  picks = weekStatuses[weekNumber].picks.map((p) => ({ team: p.team, matchup: p.matchup || `week${weekNumber}` }));
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

    const chevron = document.createElement("span");
    chevron.className = "weekday-chevron";
    chevron.textContent = "▾";
    headerRow.addEventListener("click", () => dayContainer.classList.toggle("collapsed"));

    headerRow.appendChild(dayHeader);
    headerRow.appendChild(chevron);
    dayContainer.appendChild(headerRow);

    games.forEach(({ game, idx }) => {
      const matchupKey = `week${weekNumber}_game${idx}`;

      const weekTimes = gameTimes.find((w) => w.week === weekNumber);
      let gameTime = "";
      let note = "";
      if (weekTimes) {
        const match = weekTimes.games.find((g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam);
        if (match) {
          gameTime = match.gameTimeISO ? formatLocalGameTime(match.gameTimeISO) : match.gameTime || "";
          note = match.note || "";
        }
      }

      dayContainer.appendChild(createMatchupCard(game, matchupKey, gameTime, note));
    });

    matchupsDiv.appendChild(dayContainer);
  }

  fitTeamBoxLabels();
}

// Long team names shrink to fit their box first; if even the smallest
// readable size still doesn't fit, it wraps rather than getting an ellipsis.
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
    if (label.scrollWidth > label.clientWidth) label.style.whiteSpace = "normal";
  });
}

const HEADER_LABEL_MIN_FONT_PX = 10;
function fitHeaderLabels() {
  [topLeagueName, topUserDisplay].forEach((label) => shrinkFontToFit(label, HEADER_LABEL_MIN_FONT_PX));
}

// =========================
// Week Nav chips
// =========================
function renderWeekNav() {
  weekNav.innerHTML = "";
  for (let w = 1; w <= 18; w++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "m3-chip week-chip";
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

function getWeekStatus(week) {
  const state = weekStatuses[week];
  if (!state || state.picks.length === 0) return "status-grey";

  const allBonus = Object.values(weekStatuses).map((s) => s?.bonus).filter(Boolean);
  const duplicates = allBonus.filter((b, i, arr) => arr.indexOf(b) !== i);

  if (state.bonus && duplicates.includes(state.bonus)) return "status-red";
  if (state.picks.length < 5 || !state.bonus) return "status-yellow";
  return "status-green";
}

// =========================
// Matchup row (away team box — "at" badge — home team box, like a
// scoreboard matchup rather than a merged two-option toggle)
// =========================
function createMatchupCard(game, matchupKey, gameTime, note) {
  const row = document.createElement("div");
  row.className = "matchup-row";

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
  homeContainer.appendChild(createTeamBox(game.homeTeam, game.awayTeam, matchupKey));

  if (note && note.toLowerCase() !== "none") {
    const noteDiv = document.createElement("div");
    noteDiv.className = "matchup-note";
    noteDiv.textContent = note;
    homeContainer.appendChild(noteDiv);
  }

  centerCol.appendChild(away);
  centerCol.appendChild(at);
  centerCol.appendChild(homeContainer);
  row.appendChild(centerCol);

  return row;
}

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

  box.appendChild(logo);
  box.appendChild(label);

  if (picks.find((p) => p.team === team && p.matchup === matchupKey)) {
    box.classList.add("selected");
  }

  box.addEventListener("click", () => toggleTeam(team, opponent, box, matchupKey));
  return box;
}

// =========================
// Toggle Team
// =========================
function toggleTeam(team, opponent, element, matchupKey) {
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
    const oldEl = document.querySelector(`.team-box[data-team="${oldTeam}"][data-matchup="${matchupKey}"]`);
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

  if (picks.length === 5) openPicksDrawer();
}

// =========================
// Render Picks (sidebar chips)
// =========================
function renderPicks() {
  picksList.innerHTML = "";

  picks.forEach((p) => {
    const wrapper = document.createElement("div");
    wrapper.className = "pick-chip";
    if (p.team === bonusPick) wrapper.classList.add("bonus");

    const logo = document.createElement("img");
    logo.src = getLogoPath(p.team);
    logo.alt = `${p.team} logo`;

    const label = document.createElement("span");
    label.textContent = p.team;

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

function removePick(pick) {
  if (bonusPick === pick.team) bonusPick = null;
  picks = picks.filter((x) => !(x.team === pick.team && x.matchup === pick.matchup));
  const box = document.querySelector(`.team-box[data-team="${pick.team}"][data-matchup="${pick.matchup}"]`);
  if (box) box.classList.remove("selected");
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
        alertImg.src = "/icons/alert.png";
        alertImg.alt = "Duplicate bonus";
        alertImg.className = "bonus-alert";
        row.appendChild(alertImg);
      }

      if (bonusTeam) {
        const logo = document.createElement("img");
        logo.src = getLogoPath(bonusTeam);
        logo.alt = `${bonusTeam} logo`;
        logo.className = "bonus-team-logo";
        row.appendChild(logo);
      }

      const label = document.createElement("span");
      label.textContent = `WEEK ${w}: ${bonusTeam || ""}`;
      if (bonusTeam && allBonus[bonusTeam]?.length > 1) label.classList.add("bonus-duplicate");
      row.appendChild(label);

      colDiv.appendChild(row);
    }
    container.appendChild(colDiv);
  }

  tracker.appendChild(container);
}

// =========================
// Submit button state
// =========================
function updateSubmitButton() {
  let allValid = true;
  for (let w = 1; w <= 18; w++) {
    const state = weekStatuses[w];
    if (!state || state.picks.length < 5 || !state.bonus) { allValid = false; break; }
  }
  const allBonus = Object.values(weekStatuses).map((s) => s?.bonus).filter(Boolean);
  const duplicates = allBonus.filter((b, i, arr) => arr.indexOf(b) !== i);
  if (duplicates.length > 0) allValid = false;

  submitBtn.disabled = !allValid;
  submitBtn.classList.toggle("m3-btn-filled", allValid);
  submitBtn.classList.toggle("m3-btn-tonal", !allValid);
}

// =========================
// Summary screen
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
      const sortedPicks = [...state.picks].sort((a, b) => {
        if (a.team === state.bonus) return -1;
        if (b.team === state.bonus) return 1;
        return 0;
      });

      const picksHTML = sortedPicks.map((p) => {
        const weekObj = gameData.find((wk) => wk.week === w);
        const game = weekObj?.games.find((g) => g.homeTeam === p.team || g.awayTeam === p.team);

        let matchup = "";
        let dayTimeText = "";
        if (game) {
          if (game.homeTeam === p.team) matchup = `<strong>${p.team}</strong> vs. ${game.awayTeam}`;
          else matchup = `<strong>${p.team}</strong> @ ${game.homeTeam}`;

          const weekTimes = gameTimes.find((wt) => wt.week === w);
          const timeMatch = weekTimes?.games.find((g) => g.homeTeam === game.homeTeam && g.awayTeam === game.awayTeam);
          const timeText = timeMatch?.gameTimeISO ? formatLocalGameTime(timeMatch.gameTimeISO) : timeMatch?.gameTime || "";
          dayTimeText = [game.weekday, timeText].filter(Boolean).join(" · ");
        }

        const logo = `<img src="${getLogoPath(p.team)}">`;
        const liClass = p.team === state.bonus ? "summary-bonus" : "";

        return `<li class="${liClass}">
          ${logo}
          <span class="summary-pick-info">
            <span class="summary-pick-matchup">${matchup}</span>
            ${dayTimeText ? `<span class="summary-pick-time">${dayTimeText}</span>` : ""}
          </span>
        </li>`;
      }).join("");

      div.innerHTML = `${header}<ul>${picksHTML}</ul>`;
    }

    summaryContent.appendChild(div);
  }
}

// =========================
// Button events
// =========================
submitBtn.addEventListener("click", () => {
  if (!submitBtn.disabled) {
    mainContent.style.display = "none";
    weekSelectRow.style.display = "none";
    // Reuses the week-title slot (left side of .league-player-row) instead
    // of hiding it — keeps the league/player info pinned on the right the
    // same way it is on the matchups screen, rather than left-hidden's
    // single remaining flex item collapsing to the left edge.
    weekTitleEl.textContent = "Summary of Picks";
    closePicksDrawer();
    picksBottomBar.style.display = "none";
    summaryScreen.classList.remove("hidden");
    summaryActions.classList.remove("hidden");
    renderSummary();
  }
});

window.addEventListener("beforeunload", () => { flushPendingAutosaves(); });

backBtn.addEventListener("click", () => {
  summaryScreen.classList.add("hidden");
  summaryActions.classList.add("hidden");
  mainContent.style.display = "flex";
  weekSelectRow.style.display = "flex";
  weekTitleEl.textContent = `WEEK ${currentWeek}`;
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
    console.error("Error submitting:", err);
    showToast("Error while submitting: " + err.message, "error");
  }
});

// =========================
// Init with Auth Listener
// =========================
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  currentLeagueId = localStorage.getItem("pick5_currentLeagueId");
  if (!currentLeagueId) {
    matchupsDiv.innerHTML = "<p>⚠️ No league selected. Head back to the dashboard and pick a league first.</p>";
    return;
  }

  loadLeagueHeaderInfo(user.uid);
  await initPicksEntry();
});

// Decides between three outcomes before rendering week 1: already submitted
// for this league (bounce to the dashboard — nothing left to do here),
// first-ever picks with a fully-submitted league elsewhere (offer to copy
// them in), or the normal from-scratch picks flow.
async function initPicksEntry() {
  try {
    const [myLeagues, serverPicks] = await Promise.all([
      authedFetch("/api/leagues/mine"),
      getMyPicks(currentLeagueId),
    ]);

    const currentLeague = myLeagues.find((l) => l.id === currentLeagueId);
    if (currentLeague?.submitted) {
      window.location.href = "dashboard.html";
      return;
    }

    const hasNoPicksYet = Object.keys(serverPicks).length === 0;
    const submittedElsewhere = myLeagues.filter((l) => l.id !== currentLeagueId && l.submitted);

    if (hasNoPicksYet && submittedElsewhere.length > 0) {
      showCopyPicksModal(submittedElsewhere);
      return;
    }
  } catch (err) {
    console.error("Error checking league submission status:", err);
    // fall through to the normal picks flow either way
  }

  await loadGameData();
}

function showCopyPicksModal(sourceLeagues) {
  if (sourceLeagues.length === 1) {
    copyPicksLeagueList.innerHTML = `<p class="copy-picks-single">We'll copy your picks from <strong>${sourceLeagues[0].name}</strong>.</p>`;
  } else {
    copyPicksLeagueList.innerHTML = "";
    sourceLeagues.forEach((league, i) => {
      const label = document.createElement("label");
      label.className = "copy-picks-league-option";
      label.innerHTML = `
        <input type="radio" name="copy-picks-source" value="${league.id}" ${i === 0 ? "checked" : ""}>
        <span>${league.name}</span>
      `;
      copyPicksLeagueList.appendChild(label);
    });
  }

  copyPicksModal.classList.remove("hidden");

  copyPicksSkipBtn.onclick = () => {
    copyPicksModal.classList.add("hidden");
    loadGameData();
  };

  copyPicksConfirmBtn.onclick = async () => {
    const selected = copyPicksLeagueList.querySelector("input[name='copy-picks-source']:checked");
    const fromLeagueId = selected ? selected.value : sourceLeagues[0].id;

    copyPicksConfirmBtn.disabled = true;
    copyPicksConfirmBtn.textContent = "Copying...";
    try {
      await authedFetch(`/api/leagues/${currentLeagueId}/picks/import`, {
        method: "POST",
        body: JSON.stringify({ fromLeagueId }),
      });
      copyPicksModal.classList.add("hidden");
      await loadGameData();
    } catch (err) {
      console.error("Error copying picks:", err);
      showToast("Error copying picks: " + err.message, "error");
      copyPicksConfirmBtn.disabled = false;
      copyPicksConfirmBtn.textContent = "Copy Picks";
    }
  };
}

async function loadLeagueHeaderInfo(uid) {
  try {
    const league = await authedFetch(`/api/leagues/${currentLeagueId}`);
    topLeagueName.textContent = league.name;
    const me = league.members?.find((m) => m.uid === uid);
    topUserDisplay.textContent = me?.displayName || "";
    fitHeaderLabels();
  } catch (err) {
    console.error("Error loading league header info:", err);
  }
}
