// ============================
// Firebase Auth Handling
// ============================
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "../auth/firebase_init.js";
import { authedFetch, publicFetch } from "../util/api.js";

const auth = getAuth(app);

// ============================
// Fetch helpers
// ============================
async function fetchGames() {
  return publicFetch("/api/games");
}
async function fetchLastUpdated() {
  return publicFetch("/api/last-updated");
}
async function fetchDates() {
  const res = await fetch("../src/data/game/dates.json");
  return res.json();
}
async function fetchLeagueScores(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}/scores`);
}
async function fetchMyLeagues() {
  return authedFetch("/api/leagues/mine");
}
async function fetchMyWeek(leagueId, week) {
  return authedFetch(`/api/leagues/${leagueId}/my-week?week=${week}`);
}
async function fetchLeagueStats(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}/stats`);
}
async function fetchSeasonHistory(leagueId, year) {
  return authedFetch(`/api/leagues/${leagueId}/seasons/${year}`);
}
async function fetchLeagueSeasons(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}/seasons`);
}
async function fetchLeagueDetail(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}`);
}

// The server sends last_updated as a plain ISO 8601 timestamp (timezone-
// agnostic); formatting for display happens here, in each viewer's own
// browser, so players in different timezones (Pacific, Central, etc.) each
// see it in their own local time rather than one timezone hardcoded for
// everyone.
function formatLocalTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(isoString));
}

// ============================
// Get Current Week
// ============================
async function getCurrentWeek() {
  const [lastUpdatedRes, datesData] = await Promise.all([
    fetchLastUpdated(),
    fetchDates()
  ]);

  const currentDate = new Date(lastUpdatedRes.last_updated);

  if (isNaN(currentDate.getTime())) {
    console.error("❌ Failed to parse last_updated:", lastUpdatedRes.last_updated);
  } else {
    console.log("📅 Current Date Parsed:", currentDate.toString());
  }

  let currentWeek = 1;
  for (let i = 0; i < datesData.length; i++) {
    const week = datesData[i];

    // Grab all game dates for this week
    const gameDates = Object.values(week)
      .filter(v => typeof v === "string" && /^\d{8}$/.test(v))
      .map(dateStr => {
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10) - 1;
        const day = parseInt(dateStr.substring(6, 8), 10);
        return new Date(year, month, day);
      });

    // ✅ use the latest date (usually Monday)
    const latest = new Date(Math.max(...gameDates.map(d => d.getTime())));

    // ✅ Only advance AFTER Monday → i.e., starting Tuesday
    const cutoff = new Date(latest);
    cutoff.setDate(cutoff.getDate() + 1); // move to Tuesday

    if (currentDate >= cutoff && i + 1 < datesData.length) {
      currentWeek = datesData[i + 1].week;
    }

  }

  console.log("📅 Current Date:", currentDate.toString());
  console.log("🏈 Current Week Determined:", currentWeek);

  return currentWeek;
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- UI Elements
  const tabButtons = document.querySelectorAll(".dashboard-tabs button");
  const sections = document.querySelectorAll(".tab-section");
  const weekButtonsContainer = document.getElementById("week-buttons");
  const leaderboardTitle = document.getElementById("leaderboard-title");
  const picksTitle = document.getElementById("picks-title");
  const myWeekTitle = document.getElementById("my-week-title");
  const lastUpdatedTime = document.getElementById("last-updated-time");
  const playerSelect = document.getElementById("select-player");
  const teamSelect = document.getElementById("select-team");
  const weeklyGrid = document.getElementById("weekly-picks-grid");
  const counterEl = document.getElementById("team-pick-counter");
  const toggleScoresBtn = document.getElementById("toggle-scores-btn");
  const matchupsContainer = document.getElementById("matchups-container");
  const matchupsList = document.getElementById("matchups-list");

  // --- Auth UI
  const userName = document.getElementById("user-name");
  const settingsBtn = document.getElementById("settings-btn");
  const logoutBtn = document.getElementById("logout-btn");

  // --- League shortcut (header dropdown)
  const leagueShortcut = document.getElementById("league-shortcut");
  const leagueSelect = document.getElementById("league-select");

  // --- How to Play
  const howToPlayBtn = document.getElementById("how-to-play-btn");
  const howToPlayModal = document.getElementById("how-to-play-modal");
  const howToPlayCaret = document.getElementById("how-to-play-caret");
  const closeHowToPlay = document.getElementById("close-how-to-play");

  // --- Message board
  const messageBoardBtn = document.getElementById("message-board-btn");
  const messageBoardModal = document.getElementById("message-board-modal");
  const messageBoardCaret = document.getElementById("message-board-caret");
  const closeMessageBoard = document.getElementById("close-message-board");
  const postForm = document.getElementById("post-form");
  const postBody = document.getElementById("post-body");
  const postBodyCounter = document.getElementById("post-body-counter");
  const postsList = document.getElementById("posts-list");
  const POST_BODY_MAX_LEN = 250;

  // --- League stats / Hall of Fame
  const leagueStatsBtn = document.getElementById("league-stats-btn");
  const leagueStatsModal = document.getElementById("league-stats-modal");
  const leagueStatsCaret = document.getElementById("league-stats-caret");
  const closeLeagueStats = document.getElementById("close-league-stats");
  const statsTabSeason = document.getElementById("stats-tab-season");
  const statsTabHof = document.getElementById("stats-tab-hof");
  const statsSeasonPanel = document.getElementById("stats-season-panel");
  const statsHofPanel = document.getElementById("stats-hof-panel");
  const statsSeasonBody = document.getElementById("stats-season-body");
  const hofYearSelect = document.getElementById("hof-year-select");
  const hofLoadBtn = document.getElementById("hof-load-btn");
  const hofAwards = document.getElementById("hof-awards");

  // --- My Week elements
  const myWeekBonus = document.getElementById("my-week-bonus");
  const myWeekTeamsToWatch = document.getElementById("my-week-teams-to-watch");
  const myWeekProfilePic = document.getElementById("my-week-profile-pic");
  const myWeekName = document.getElementById("my-week-name");
  const myWeekOverallPos = document.getElementById("my-week-overall-pos");
  const myWeekWinChance = document.getElementById("my-week-win-chance");
  const myWeekHateWatch = document.getElementById("my-week-hate-watch");

  // --- Leaderboard elements
  const leaderboardPodium = document.getElementById("leaderboard-podium");
  const leaderboardList = document.getElementById("leaderboard-list");

  // --- State
  let currentTab = "leaderboard";
  let currentWeek = null;
  let scoresData = {}; // keyed by uid, same shape downstream code already expects
  let allPlayers = [];
  let loggedInUser = null; // ✅ track logged in user name
  let myLeagues = [];
  let currentLeagueId = localStorage.getItem("pick5_currentLeagueId") || null;
  let isLeagueOwner = false;

  // --- Settings Modal Elements (per-league profile, not global)
  const settingsModal = document.getElementById("settings-modal");
  const settingsCaret = document.getElementById("settings-caret");
  const closeSettings = document.getElementById("close-settings");
  const settingsForm = document.getElementById("settings-form");
  const displayNameInput = document.getElementById("display-name");
  const profileUrlInput = document.getElementById("profile-url");

  const DEFAULT_AVATAR = "../icons/default_avatar.png";

  // Every header popover opens at the same fixed spot (near the header's
  // right edge, just below it) regardless of which icon triggered it — only
  // the caret moves, to point at that specific icon. Computed from live
  // layout (not hardcoded per breakpoint) so it's correct on both the
  // desktop one-row header and the mobile two-row one.
  const POPOVER_RIGHT_MARGIN = 16;
  function positionPopover(modalEl, caretEl, buttonEl) {
    const header = document.querySelector(".dashboard-header");
    const headerRect = header.getBoundingClientRect();
    const modalContent = modalEl.querySelector(".modal-content");
    const gap = 10;
    const top = headerRect.bottom + gap;
    const right = window.innerWidth - headerRect.right + POPOVER_RIGHT_MARGIN;

    modalContent.style.top = `${top}px`;
    modalContent.style.right = `${right}px`;

    const btnRect = buttonEl.getBoundingClientRect();
    const caretLeft = btnRect.left + btnRect.width / 2 - 9;
    caretEl.style.top = `${top - 9}px`;
    caretEl.style.left = `${caretLeft}px`;
  }

  // Only one header popover open at a time: opening a new one closes
  // whatever else was open, and clicking the currently-open one's own
  // button again just closes it (rather than re-opening in place).
  const allPopoverModals = [];
  function registerPopoverModal(modalEl) {
    allPopoverModals.push(modalEl);
  }
  function closeAllPopovers() {
    allPopoverModals.forEach((m) => m.classList.add("hidden"));
  }
  function togglePopover(modalEl, caretEl, buttonEl, onOpen) {
    const wasOpen = !modalEl.classList.contains("hidden");
    closeAllPopovers();
    if (wasOpen) return;
    positionPopover(modalEl, caretEl, buttonEl);
    modalEl.classList.remove("hidden");
    if (onOpen) onOpen();
  }

  // =========================
  // Firebase Auth State
  // =========================
  // No guest mode: every league requires an invite code to join, so viewing
  // a league's dashboard without being signed in never makes sense. Same
  // persistent-listener redirect pattern as leagues.html.
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    let name = user.displayName || user.email || "User";
    try {
      const profile = await authedFetch("/api/profile/me");
      if (profile.displayName) name = profile.displayName;
    } catch (err) {
      console.error("❌ Error loading profile:", err);
    }
    loggedInUser = name;
    userName.textContent = name;

    settingsBtn.style.display = "inline-block";
    messageBoardBtn.style.display = "inline-block";
    leagueStatsBtn.style.display = "inline-block";
    logoutBtn.style.display = "inline-block";
    leagueShortcut.style.display = "flex";

    logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.reload();
    };

    await loadMyLeagues();
  });

  // =========================
  // League shortcut (full management lives on leagues.html now)
  // =========================
  async function loadMyLeagues() {
    try {
      myLeagues = await fetchMyLeagues();
    } catch (err) {
      console.error("❌ Error loading leagues:", err);
      myLeagues = [];
    }

    if (myLeagues.length === 0) {
      // Brand new user, or every league they were in got archived — send
      // them to the dedicated League Select screen rather than showing an
      // empty dashboard with nothing to do.
      window.location.href = "leagues.html";
      return;
    }

    // keep the saved selection only if it's still one of the caller's leagues
    if (!myLeagues.find((l) => l.id === currentLeagueId)) {
      currentLeagueId = myLeagues[0].id;
    }
    setCurrentLeague(currentLeagueId);
    isLeagueOwner = myLeagues.find((l) => l.id === currentLeagueId)?.role === "owner";

    leagueSelect.innerHTML = "";
    myLeagues.forEach((league) => {
      const opt = document.createElement("option");
      opt.value = league.id;
      opt.textContent = league.name;
      leagueSelect.appendChild(opt);
    });
    leagueSelect.value = currentLeagueId;

    showSection(currentTab);
  }

  function setCurrentLeague(leagueId) {
    currentLeagueId = leagueId;
    if (leagueId) {
      localStorage.setItem("pick5_currentLeagueId", leagueId);
    } else {
      localStorage.removeItem("pick5_currentLeagueId");
    }
  }

  leagueSelect.addEventListener("change", () => {
    setCurrentLeague(leagueSelect.value);
    isLeagueOwner = myLeagues.find((l) => l.id === currentLeagueId)?.role === "owner";
    showSection(currentTab);
  });

  // =========================
  // How to Play
  // =========================
  registerPopoverModal(howToPlayModal);
  howToPlayBtn.onclick = () => togglePopover(howToPlayModal, howToPlayCaret, howToPlayBtn);
  closeHowToPlay.onclick = () => closeAllPopovers();

  // =========================
  // Message board
  // =========================
  registerPopoverModal(messageBoardModal);
  messageBoardBtn.onclick = () => togglePopover(messageBoardModal, messageBoardCaret, messageBoardBtn, loadPosts);
  closeMessageBoard.onclick = () => closeAllPopovers();

  postBody.addEventListener("input", () => {
    const len = postBody.value.length;
    postBodyCounter.textContent = `${len}/${POST_BODY_MAX_LEN}`;
    postBodyCounter.classList.toggle("limit-reached", len >= POST_BODY_MAX_LEN);
  });

  async function loadPosts() {
    postsList.innerHTML = "<li>Loading...</li>";
    try {
      const posts = await authedFetch(`/api/leagues/${currentLeagueId}/posts`);
      const auth_ = auth.currentUser;
      postsList.innerHTML = "";
      if (posts.length === 0) {
        postsList.innerHTML = "<li class='no-posts'>No posts yet — say something!</li>";
      }
      posts.forEach((post) => {
        const li = document.createElement("li");
        li.className = "post-row";

        const meta = document.createElement("div");
        meta.className = "post-meta";
        meta.textContent = `${post.authorName} — ${new Date(post.createdAt).toLocaleString()}`;
        li.appendChild(meta);

        const body = document.createElement("div");
        body.className = "post-body";
        body.textContent = post.body;
        li.appendChild(body);

        if (isLeagueOwner || post.authorUid === auth_?.uid) {
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "post-delete-btn";
          deleteBtn.textContent = "Delete";
          deleteBtn.onclick = async () => {
            try {
              await authedFetch(`/api/leagues/${currentLeagueId}/posts/${post.id}`, { method: "DELETE" });
              await loadPosts();
            } catch (err) {
              alert("Error deleting post: " + err.message);
            }
          };
          li.appendChild(deleteBtn);
        }

        postsList.appendChild(li);
      });
    } catch (err) {
      postsList.innerHTML = `<li>Error loading posts: ${err.message}</li>`;
    }
  }

  postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await authedFetch(`/api/leagues/${currentLeagueId}/posts`, {
        method: "POST",
        body: JSON.stringify({ body: postBody.value.trim() }),
      });
      postBody.value = "";
      postBodyCounter.textContent = `0/${POST_BODY_MAX_LEN}`;
      postBodyCounter.classList.remove("limit-reached");
      await loadPosts();
    } catch (err) {
      alert("Error posting: " + err.message);
    }
  });

  // =========================
  // League Stats / Hall of Fame
  // =========================
  registerPopoverModal(leagueStatsModal);
  leagueStatsBtn.onclick = () =>
    togglePopover(leagueStatsModal, leagueStatsCaret, leagueStatsBtn, async () => {
      switchStatsTab("season");
      await loadSeasonStats();
    });
  closeLeagueStats.onclick = () => closeAllPopovers();

  function switchStatsTab(which) {
    statsTabSeason.classList.toggle("active", which === "season");
    statsTabHof.classList.toggle("active", which === "hof");
    statsSeasonPanel.classList.toggle("hidden", which !== "season");
    statsHofPanel.classList.toggle("hidden", which !== "hof");
  }

  statsTabSeason.onclick = async () => {
    switchStatsTab("season");
    await loadSeasonStats();
  };
  statsTabHof.onclick = async () => {
    switchStatsTab("hof");
    await populateHofYears();
  };

  async function loadSeasonStats() {
    statsSeasonBody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
    try {
      const stats = await fetchLeagueStats(currentLeagueId);
      statsSeasonBody.innerHTML = "";
      if (stats.length === 0) {
        statsSeasonBody.innerHTML = "<tr><td colspan='5'>No picks made yet this season.</td></tr>";
      }
      stats.forEach((s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${s.displayName || "Unknown"}</td>
          <td>${s.highestWeek ? `${s.highestWeek.week.replace("week", "Week ")} (${s.highestWeek.total})` : "--"}</td>
          <td>${s.weeksWon}</td>
          <td>${Math.round(s.winPct * 100)}%</td>
          <td>${s.currentStreak}</td>
        `;
        statsSeasonBody.appendChild(tr);
      });
    } catch (err) {
      statsSeasonBody.innerHTML = `<tr><td colspan='5'>Error: ${err.message}</td></tr>`;
    }
  }

  async function populateHofYears() {
    hofYearSelect.innerHTML = "<option>Loading...</option>";
    hofAwards.innerHTML = "";
    try {
      const years = await fetchLeagueSeasons(currentLeagueId);
      hofYearSelect.innerHTML = "";
      if (years.length === 0) {
        hofYearSelect.innerHTML = "<option>No finished seasons yet</option>";
        hofYearSelect.disabled = true;
        hofLoadBtn.disabled = true;
        hofAwards.innerHTML = "<p>This league doesn't have a finished season yet.</p>";
        return;
      }
      hofYearSelect.disabled = false;
      hofLoadBtn.disabled = false;
      years.forEach((y) => {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        hofYearSelect.appendChild(opt);
      });
      hofAwards.innerHTML = "<p>Pick a season and click View.</p>";
    } catch (err) {
      hofYearSelect.innerHTML = "<option>Error</option>";
      hofAwards.innerHTML = `<p>${err.message}</p>`;
    }
  }

  function awardCard(label, text) {
    return `<div class="hof-award-card"><div class="hof-award-label">${label}</div><div class="hof-award-value">${text}</div></div>`;
  }

  // One self-contained "Player — stat" line per tied player, rather than
  // stacking bare names with one shared stat line at the end — matters for
  // awards like Highest Scoring Week, where two players can each own the
  // top score but in different weeks.
  function awardLines(award, formatLine) {
    return award.players.map((p) => formatLine(p, award.best)).join("<br>");
  }

  hofLoadBtn.onclick = async () => {
    hofAwards.innerHTML = "<p>Loading...</p>";
    try {
      const s = await fetchSeasonHistory(currentLeagueId, hofYearSelect.value);

      hofAwards.innerHTML = [
        awardCard("🏆 Champion", s.champion ? awardLines(s.champion, (p, best) => `${p.name} — ${best} pts`) : "—"),
        awardCard("🔥 Highest Scoring Week", s.highestScoringWeek ? awardLines(s.highestScoringWeek, (p, best) => `${p.name} — ${p.week.replace("week", "Week ")} (${best} pts)`) : "—"),
        awardCard("📈 Longest Win Streak", s.longestWinStreak ? awardLines(s.longestWinStreak, (p, best) => `${p.name} — ${best} week${best === 1 ? "" : "s"}`) : "—"),
        awardCard("🥇 Most Weeks Won", s.mostWeeksWon ? awardLines(s.mostWeeksWon, (p, best) => `${p.name} — ${best} week${best === 1 ? "" : "s"}`) : "—"),
        awardCard("💰 Most Bonuses Won", s.mostBonusesWon ? awardLines(s.mostBonusesWon, (p, best) => `${p.name} — ${best} bonus${best === 1 ? "" : "es"}`) : "—"),
        awardCard("🤝 Most Ties", s.mostTies ? awardLines(s.mostTies, (p, best) => `${p.name} — ${best} week${best === 1 ? "" : "s"}`) : "—"),
        awardCard("🥄 Wooden Spoon", s.woodenSpoon ? awardLines(s.woodenSpoon, (p, best) => `${p.name} — ${best} pts`) : "—"),
      ].join("");
    } catch (err) {
      hofAwards.innerHTML = `<p>${err.message}</p>`;
    }
  };

  // =========================
  // Settings Modal Handlers — per-league profile
  // =========================
  registerPopoverModal(settingsModal);
  settingsBtn.onclick = () =>
    togglePopover(settingsModal, settingsCaret, settingsBtn, async () => {
      displayNameInput.value = "";
      profileUrlInput.value = "";
      try {
        const league = await fetchLeagueDetail(currentLeagueId);
        const me = league.members.find((m) => m.uid === auth.currentUser?.uid);
        displayNameInput.value = me?.displayName || "";
      } catch (err) {
        console.error("❌ Error loading league member profile:", err);
      }
    });

  closeSettings.onclick = () => closeAllPopovers();

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!auth.currentUser) return alert("You must be logged in.");

    try {
      const update = {};
      if (displayNameInput.value) update.displayName = displayNameInput.value;
      if (profileUrlInput.value) update.photoURL = profileUrlInput.value;

      await authedFetch(`/api/leagues/${currentLeagueId}/members/me`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });

      alert("✅ Profile updated for this league!");
      window.location.reload();
    } catch (err) {
      console.error("❌ Error updating profile:", err);
      alert("Error updating profile: " + err.message);
    }
  });

  const allPopoverButtons = [howToPlayBtn, messageBoardBtn, leagueStatsBtn, settingsBtn];

  window.addEventListener("click", (e) => {
    // A trigger button's own onclick already handles opening/closing/
    // switching — don't also run the generic outside-click-closes logic
    // for that same click (it bubbles up to this listener too).
    if (allPopoverButtons.some((btn) => btn.contains(e.target))) return;
    const clickedInsideOpenPopover = allPopoverModals.some(
      (m) => !m.classList.contains("hidden") && m.querySelector(".modal-content").contains(e.target)
    );
    if (!clickedInsideOpenPopover) closeAllPopovers();
  });

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
    Steelers: "steelers.png", Texans: "texans.png", Titans: "titans.png", Vikings: "vikings.png"
  };

  function getLogoPath(team) {
    const mascot = team.split(" ").pop();
    return `logos/${teamLogoMap[mascot] || "default.png"}`;
  }

  // =========================
  // Tab Switching
  // =========================
  async function showSection(tab) {
    currentTab = tab;

    if (tab === "leaderboard") {
      currentWeek = null;
    } else {
      currentWeek = await getCurrentWeek(); // both "picks" and "my-week" default to the current week
    }

    sections.forEach((section) => {
      section.style.display = section.id === `${tab}-section` ? "block" : "none";
    });
    tabButtons.forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.tab === tab)
    );

    renderWeekButtons();
    updateTitles();

    if (!currentLeagueId) {
      if (tab === "leaderboard") {
        leaderboardPodium.innerHTML = "";
        leaderboardList.innerHTML = `<li>No league selected — create or join one from the Leagues screen.</li>`;
      }
      if (tab === "picks") {
        weeklyGrid.innerHTML = `<p>No league selected — create or join one from the Leagues screen.</p>`;
      }
      if (tab === "my-week") {
        myWeekBonus.innerHTML = "";
        myWeekTeamsToWatch.innerHTML = "";
        myWeekHateWatch.innerHTML = "";
        myWeekWinChance.textContent = "No league selected";
      }
      return;
    }

    // Reload this league's scores fresh on every tab/league switch — cheap,
    // since the server computes it from its own in-memory data, not Firestore.
    try {
      const scoresArray = await fetchLeagueScores(currentLeagueId);
      scoresData = {};
      scoresArray.forEach((p) => {
        scoresData[p.uid] = {
          name: p.displayName || "Unknown",
          photoURL: p.photoURL || DEFAULT_AVATAR,
          weeks: p.weeks,
          overall_score: p.overall,
        };
      });
    } catch (err) {
      console.error("❌ Error loading scores:", err);
      scoresData = {};
    }

    if (tab === "picks") {
      loadPlayers();
      loadTeamsDropdown();
      loadWeeklyPicks(currentWeek);
      const btn = Array.from(weekButtonsContainer.children).find(b =>
        b.textContent.includes(currentWeek)
      );
      if (btn) {
        setActiveButton(btn);
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }
    if (tab === "leaderboard") {
      loadLeaderboard();
    }
    if (tab === "my-week") {
      loadMyWeek(currentWeek);
    }
  }

  // =========================
  // Week Buttons
  // =========================
  function renderWeekButtons() {
    weekButtonsContainer.innerHTML = "";
    const isMobile = window.innerWidth <= 700;

    if (currentTab === "leaderboard") {
      const overallBtn = document.createElement("button");
      overallBtn.textContent = isMobile ? "All" : "Overall";
      overallBtn.className = "week-btn status-grey";
      if (isMobile) overallBtn.classList.add("compact-btn");
      overallBtn.addEventListener("click", () => {
        currentWeek = null;
        updateTitles();
        setActiveButton(overallBtn);
        loadLeaderboard();
      });
      weekButtonsContainer.appendChild(overallBtn);
      if (currentWeek === null) setActiveButton(overallBtn);
    }

    for (let i = 1; i <= 18; i++) {
      const btn = document.createElement("button");
      btn.textContent = isMobile ? `${i}` : `Week ${i}`;
      btn.className = "week-btn status-grey";
      if (isMobile) btn.classList.add("compact-btn");
      btn.addEventListener("click", () => {
        currentWeek = i;
        updateTitles();
        setActiveButton(btn);
        if (currentTab === "picks") loadWeeklyPicks(currentWeek);
        if (currentTab === "leaderboard") loadLeaderboard();
        if (currentTab === "my-week") loadMyWeek(currentWeek);
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
      weekButtonsContainer.appendChild(btn);
      if (currentTab !== "leaderboard" && i === currentWeek) {
        setActiveButton(btn);
      }
    }
  }

  function updateTitles() {
    if (currentTab === "leaderboard") {
      leaderboardTitle.textContent =
        currentWeek === null
          ? "OVERALL LEADERBOARD"
          : `WEEK ${currentWeek} LEADERBOARD`;
    } else if (currentTab === "picks") {
      picksTitle.textContent = `WEEK ${currentWeek} PICKS`;
    } else if (currentTab === "my-week") {
      myWeekTitle.textContent = `WEEK ${currentWeek} DASHBOARD`;
    }
  }

  function setActiveButton(activeBtn) {
    const allBtns = weekButtonsContainer.querySelectorAll(".week-btn");
    allBtns.forEach((btn) => btn.classList.remove("active"));
    if (activeBtn) activeBtn.classList.add("active");
  }

  // =========================
  // Leaderboard — podium (top 3) + ranked list, scores already computed
  // server-side
  // =========================
  function loadLeaderboard() {
    leaderboardPodium.innerHTML = "";
    leaderboardList.innerHTML = "";

    const players = Object.entries(scoresData).map(([uid, player]) => {
      const score =
        currentWeek === null
          ? player.overall_score
          : player.weeks?.[`week${currentWeek}`]?.total ?? 0;

      return { uid, name: player.name, score, photoURL: player.photoURL || DEFAULT_AVATAR };
    });

    players.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

    let currentRank = 0, prevScore = null, playersSeen = 0;
    const ranked = players.map((player) => {
      playersSeen++;
      if (player.score !== prevScore) currentRank = playersSeen;
      prevScore = player.score;
      return { ...player, rank: currentRank };
    });

    // Medal rows: 1st (gold), 2nd (silver), 3rd (bronze). A rank can have
    // multiple tied players (e.g. everyone at 0 before any games finish) —
    // each tied player gets their own line within that rank's row, rather
    // than picking one arbitrarily and silently dropping the rest.
    const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };
    [1, 2, 3].forEach((rank) => {
      const tiedPlayers = ranked.filter((p) => p.rank === rank);
      if (tiedPlayers.length === 0) return;
      const row = document.createElement("div");
      row.className = `medal-row medal-rank-${rank}`;
      row.innerHTML = `
        <div class="medal-icon">${medals[rank]}</div>
        <div class="medal-players">
          ${tiedPlayers
            .map(
              (player) => `
            <div class="medal-player">
              <img src="${player.photoURL}" alt="${player.name}" class="medal-pic">
              <span class="medal-name">${player.name}</span>
              <span class="medal-score">${player.score}</span>
            </div>
          `
            )
            .join("")}
        </div>
      `;
      leaderboardPodium.appendChild(row);
    });

    // Everyone else (rank 4+), in a plain table: pos | player | points
    const rest = ranked.filter((p) => p.rank > 3);
    rest.forEach((player) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${player.rank}</td>
        <td class="leaderboard-player-cell">
          <img src="${player.photoURL}" alt="${player.name}" class="leaderboard-mini-pic">
          <span>${player.name}</span>
        </td>
        <td>${player.score}</td>
      `;
      leaderboardList.appendChild(tr);
    });
  }

  // =========================
  // My Week / Dashboard tab
  // =========================
  async function loadMyWeek(week) {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    const me = scoresData[myUid];
    myWeekProfilePic.src = me?.photoURL || DEFAULT_AVATAR;
    myWeekName.textContent = me?.name || loggedInUser || "You";

    const ranked = Object.entries(scoresData)
      .map(([uid, p]) => ({ uid, overall: p.overall_score }))
      .sort((a, b) => b.overall - a.overall);
    const myRank = ranked.findIndex((p) => p.uid === myUid) + 1;
    myWeekOverallPos.textContent = myRank ? `Overall: #${myRank} of ${ranked.length}` : "Overall: --";

    myWeekBonus.innerHTML = "Loading...";
    myWeekTeamsToWatch.innerHTML = "";
    myWeekHateWatch.innerHTML = "";
    myWeekWinChance.textContent = "Calculating chance to win the week...";

    try {
      const myWeek = await fetchMyWeek(currentLeagueId, week);

      myWeekBonus.innerHTML = "";
      if (myWeek.bonusPick) {
        const img = document.createElement("img");
        img.src = getLogoPath(myWeek.bonusPick);
        img.alt = myWeek.bonusPick;
        img.className = "my-week-team-logo";
        myWeekBonus.appendChild(img);
        const label = document.createElement("span");
        label.textContent = `${myWeek.bonusPick} (Bonus)`;
        label.className = "my-week-bonus-label";
        myWeekBonus.appendChild(label);
      } else {
        myWeekBonus.textContent = "No bonus pick set for this week";
      }

      myWeekTeamsToWatch.innerHTML = "";
      if (myWeek.teamsToWatch.length === 0) {
        myWeekTeamsToWatch.innerHTML = "<li>No picks made for this week</li>";
      }
      myWeek.teamsToWatch.forEach((team) => {
        const li = document.createElement("li");
        li.innerHTML = `<img src="${getLogoPath(team)}" alt="${team}" class="my-week-team-logo"> ${team}`;
        myWeekTeamsToWatch.appendChild(li);
      });

      myWeekHateWatch.innerHTML = "";
      if (myWeek.hateWatch.length === 0) {
        myWeekHateWatch.innerHTML = "<li>Nobody threatening your spot yet</li>";
      }
      myWeek.hateWatch.forEach((team) => {
        const li = document.createElement("li");
        li.innerHTML = `<img src="${getLogoPath(team)}" alt="${team}" class="my-week-team-logo"> ${team}`;
        myWeekHateWatch.appendChild(li);
      });

      myWeekWinChance.textContent = `% chance to win the week: ${myWeek.winChancePct}%`;
    } catch (err) {
      console.error("❌ Error loading my-week:", err);
      myWeekBonus.textContent = "Error loading this week's data";
      myWeekWinChance.textContent = "";
    }
  }

  // =========================
  // Players Dropdown
  // =========================
  function loadPlayers() {
    allPlayers = Object.entries(scoresData).map(([uid, player]) => ({
      uid,
      name: player.name,
    }));
    playerSelect.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Players";
    playerSelect.appendChild(allOpt);
    allPlayers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.uid;
      opt.textContent = p.name;
      playerSelect.appendChild(opt);
    });
    playerSelect.value = "all";
  }

  // =========================
  // Teams Dropdown
  // =========================
  function loadTeamsDropdown() {
    teamSelect.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Teams";
    teamSelect.appendChild(allOpt);
    const teamSet = new Set();
    Object.values(scoresData).forEach((player) => {
      Object.values(player.weeks || {}).forEach((week) => {
        Object.keys(week.teams || {}).forEach((team) => teamSet.add(team));
      });
    });
    Array.from(teamSet)
      .sort()
      .forEach((team) => {
        const opt = document.createElement("option");
        opt.value = team;
        opt.textContent = team;
        teamSelect.appendChild(opt);
      });
    teamSelect.value = "all";
  }

  // =========================
  // Picks Grid — points/bonus already computed server-side per team
  // =========================
  async function loadWeeklyPicks(weekNumber) {
    weeklyGrid.innerHTML = "";
    const gamesData = await fetchGames();
    const gamesForWeek = gamesData.find((g) => g.week === weekNumber)?.games || [];
    const selectedPlayer = playerSelect.value;
    const selectedTeam = teamSelect.value;

    const playersToShow =
      selectedPlayer === "all"
        ? allPlayers.slice()
        : allPlayers.filter((p) => p.uid === selectedPlayer);

    const playerCards = playersToShow.map((player) => {
      const weekData = scoresData[player.uid].weeks?.[`week${weekNumber}`] || { teams: {}, total: 0 };
      return { ...player, weekData, correctedTotal: weekData.total || 0 };
    });

    // ✅ Sort by total (desc), then name
    playerCards.sort((a, b) => {
      if (b.correctedTotal !== a.correctedTotal) {
        return b.correctedTotal - a.correctedTotal;
      }
      return a.name.localeCompare(b.name);
    });

    let countPicked = 0;

    playerCards.forEach((player) => {
      const weekData = player.weekData;
      const card = document.createElement("div");
      card.className = "pick-box";

      if (loggedInUser && player.name === loggedInUser) {
        card.style.border = "3px solid gold";
      }

      const title = document.createElement("div");
      title.className = "player-header";
      title.innerHTML = `
        <img src="${scoresData[player.uid].photoURL || DEFAULT_AVATAR}"
            alt="${player.name}" class="profile-pic">
        <h3>${player.name}</h3>
      `;
      card.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "pick-list";

      if (!weekData || Object.keys(weekData.teams).length === 0) {
        const li = document.createElement("li");
        li.textContent = "No picks submitted";
        ul.appendChild(li);
      } else {
        const bonusTeam = Object.entries(weekData.teams).find(
          ([, info]) => info.bonus
        );
        const otherTeams = Object.entries(weekData.teams).filter(
          ([, info]) => !info.bonus
        );
        otherTeams.sort(([a], [b]) => {
          const idxA = gamesForWeek.findIndex(
            (g) => g.homeTeam === a || g.awayTeam === a
          );
          const idxB = gamesForWeek.findIndex(
            (g) => g.homeTeam === b || g.awayTeam === b
          );
          return idxA - idxB;
        });

        const orderedTeams = [];
        if (bonusTeam) orderedTeams.push(bonusTeam);
        orderedTeams.push(...otherTeams);
        let pickedThisTeam = false;

        for (const [team, info] of orderedTeams) {
          const li = document.createElement("li");
          li.className = "pick-row";
          if (info.bonus) li.classList.add("bonus");
          if (selectedTeam !== "all" && team === selectedTeam) {
            li.style.backgroundColor = "lightblue";
            pickedThisTeam = true;
          }

          const game = gamesForWeek.find(
            (g) => g.homeTeam === team || g.awayTeam === team
          );

          let teamColor = "black";
          if (game && game.status === "Completed") {
            teamColor = info.points > 0 ? "green" : "red";
          }

          const logo = document.createElement("img");
          logo.src = getLogoPath(team);
          logo.alt = team;
          logo.className = "team-logo";
          li.appendChild(logo);

          const nameSpan = document.createElement("span");
          nameSpan.className = "team-name";
          nameSpan.textContent = team;
          nameSpan.style.color = teamColor;
          li.appendChild(nameSpan);

          const ptsSpan = document.createElement("span");
          ptsSpan.className = "team-points";
          ptsSpan.textContent = info.points;
          li.appendChild(ptsSpan);

          ul.appendChild(li);
        }

        if (pickedThisTeam) countPicked++;
      }
      card.appendChild(ul);

      const totalRow = document.createElement("div");
      totalRow.style.marginTop = "8px";
      totalRow.style.fontWeight = "bold";
      totalRow.style.textAlign = "center";
      totalRow.style.color = "white";
      totalRow.style.borderTop = "1px solid #ccc";
      totalRow.style.paddingTop = "6px";
      totalRow.textContent = `Total: ${player.correctedTotal}`;
      card.appendChild(totalRow);

      weeklyGrid.appendChild(card);
    });

    counterEl.style.display = selectedTeam !== "all" ? "inline" : "none";
    if (selectedTeam !== "all")
      counterEl.textContent = `${countPicked}/${allPlayers.length} player(s)`;

    if (!matchupsContainer.classList.contains("hidden")) {
      renderMatchups(gamesForWeek);
    }
  }

  // =========================
  // Matchups Rendering
  // =========================
  function renderMatchups(gamesForWeek) {
    matchupsList.innerHTML = "";
    const gamesByDay = {};
    gamesForWeek.forEach((game) => {
      const day = game.weekday || "Unknown";
      if (!gamesByDay[day]) gamesByDay[day] = [];
      gamesByDay[day].push(game);
    });

    Object.entries(gamesByDay).forEach(([day, games]) => {
      const dayBox = document.createElement("div");
      dayBox.className = "day-box";

      const header = document.createElement("div");
      header.className = "day-header";
      header.textContent = day;
      dayBox.appendChild(header);

      games.forEach((game) => {
        const row = document.createElement("div");
        row.className = "matchup-row";

        const away = document.createElement("div");
        away.className = "team-label away-label";
        const awayLogo = document.createElement("img");
        awayLogo.src = getLogoPath(game.awayTeam);
        awayLogo.className = "matchup-logo";
        away.appendChild(awayLogo);
        away.append(game.awayTeam);

        const awayScore = document.createElement("div");
        awayScore.className = "team-score";
        awayScore.textContent = game.awayScore;

        const homeScore = document.createElement("div");
        homeScore.className = "team-score";
        homeScore.textContent = game.homeScore;

        const home = document.createElement("div");
        home.className = "team-label home-label";
        const homeLogo = document.createElement("img");
        homeLogo.src = getLogoPath(game.homeTeam);
        homeLogo.className = "matchup-logo";
        home.appendChild(homeLogo);
        home.append(game.homeTeam);

        if (game.status === "Completed") {
          if (game.homeScore > game.awayScore) {
            home.classList.add("winner");
            homeScore.classList.add("winner");
            away.classList.add("loser");
            awayScore.classList.add("loser");
          } else {
            away.classList.add("winner");
            awayScore.classList.add("winner");
            home.classList.add("loser");
            homeScore.classList.add("loser");
          }
        }

        row.appendChild(away);
        row.appendChild(awayScore);
        row.appendChild(homeScore);
        row.appendChild(home);

        dayBox.appendChild(row);
      });

      matchupsList.appendChild(dayBox);
    });
  }

  // =========================
  // Init
  // =========================
  try {
    const lastUpdatedData = await fetchLastUpdated();
    lastUpdatedTime.textContent = lastUpdatedData.last_updated
      ? formatLocalTime(lastUpdatedData.last_updated)
      : "[Unknown]";
  } catch {
    lastUpdatedTime.textContent = "[Error]";
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => showSection(btn.dataset.tab))
  );

  toggleScoresBtn.addEventListener("click", async () => {
    matchupsContainer.classList.toggle("hidden");
    if (!matchupsContainer.classList.contains("hidden")) {
      const gamesData = await fetchGames();
      const gamesForWeek =
        gamesData.find((g) => g.week === currentWeek)?.games || [];
      renderMatchups(gamesForWeek);
    }
  });

  playerSelect.addEventListener("change", () => {
    if (currentTab === "picks") loadWeeklyPicks(currentWeek);
  });
  teamSelect.addEventListener("change", () => {
    if (currentTab === "picks") loadWeeklyPicks(currentWeek);
  });

  // Deliberately no unconditional showSection() call here — the auth
  // listener above always fires at least once on load (with a user or
  // null) and triggers the first render itself. Calling showSection()
  // here too raced Firebase Auth's session restore: if localStorage
  // already had a league ID saved from a previous session, this would
  // fire fetchLeagueScores() before auth.currentUser was populated,
  // throwing "Not signed in".
});
