// Dashboard controller — targets the nav-rail/nav-bar + M3 dialog DOM. The
// old tabs+popover version lives on at src/js/v1/dashboard.js.
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "../auth/firebase_init.js";
import { authedFetch, publicFetch, getSeasonConfig } from "../util/api.js";
import { initHeaderMenu } from "../util/header-menu.js";
import { initThemeSwitcher } from "../util/theme.js";
import { showToast } from "../util/toast.js";
import { initPhotoPicker } from "../util/photo-picker.js";
import { openLightbox } from "../util/lightbox.js";
import { attemptAuthStallRecovery, clearAuthStallRecoveryFlag } from "../util/auth-recovery.js";
import { shrinkFontToFit } from "../util/fit-text.js";

const auth = getAuth(app);
const DEFAULT_AVATAR = "/icons/default_avatar.png";

// Hall of Fame award icon — custom SVG (no emoji), shown only on the
// Champion card; the other award cards are plain (title + stats only).
const HOF_ICON_TROPHY = `<svg viewBox="0 0 512 512" aria-hidden="true"><g fill="currentColor">
  <path d="M160 90h192v96c0 60-40 96-96 96s-96-36-96-96V90z"/>
  <path d="M210 120c-80 0-126 32-126 70 0 40 38 68 92 74l6-40c-34-4-58-20-58-36 0-20 24-32 86-32v-36z"/>
  <path d="M302 120c80 0 126 32 126 70 0 40-38 68-92 74l-6-40c34-4 58-20 58-36 0-20-24-32-86-32v-36z"/>
  <path d="M230 280h52l6 70h-64z"/>
  <path d="M188 350h136l12 38H176z"/>
  <rect x="160" y="388" width="192" height="38" rx="9"/>
</g></svg>`;

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Visit dashboard.html?demo=leaderboard to preview the podium with fake
// standings (including ties) instead of the real league's scores — doesn't
// touch Firestore, just swaps what loadLeaderboard() renders from.
const DEMO_LEADERBOARD = new URLSearchParams(location.search).get("demo") === "leaderboard";
const DEMO_SCORES = [
  { uid: "demo-1", displayName: "Fumble Duggery", photoURL: "https://i.pravatar.cc/150?img=1", overall: 150, weeks: {} },
  { uid: "demo-2", displayName: "Ryan's Goat Farm", photoURL: "https://i.pravatar.cc/150?img=3", overall: 130, weeks: {} },
  { uid: "demo-3", displayName: "Mahomes Away From Home", photoURL: "https://i.pravatar.cc/150?img=4", overall: 110, weeks: {} },
  { uid: "demo-4", displayName: "Prime Time Toilet Bowl", photoURL: "https://i.pravatar.cc/150?img=5", overall: 110, weeks: {} },
  { uid: "demo-5", displayName: "The Blitz Sisters", photoURL: "https://i.pravatar.cc/150?img=2", overall: 90, weeks: {} },
  { uid: "demo-6", displayName: "Sacked & Confused", photoURL: "https://i.pravatar.cc/150?img=6", overall: 80, weeks: {} },
];

// ============================
// Fetch helpers
// ============================
async function fetchGames() { return publicFetch("/api/games"); }
async function fetchLastUpdated() { return publicFetch("/api/last-updated"); }

// Message board timestamps drop the year while it matches the season's own
// start year (the common case all season long) and bring it back once a
// post genuinely falls outside that year — e.g. carried-over history once
// a new season rolls the config year forward.
let seasonYearPromise = null;
async function getCachedSeasonYear() {
  if (!seasonYearPromise) seasonYearPromise = getSeasonConfig().then((cfg) => cfg.year);
  return seasonYearPromise;
}
function formatPostTime(dateInput, seasonYear) {
  const date = new Date(dateInput);
  const opts = { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
  if (date.getFullYear() !== seasonYear) opts.year = "numeric";
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Centered divider text grouping runs of messages by calendar day, the same
// idea as iMessage's "Today"/"Yesterday" dividers between message clusters.
function formatDateDivider(date) {
  const now = new Date();
  if (isSameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  const opts = { weekday: "long", month: "long", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}
async function fetchDates() {
  const res = await fetch("/src/data/game/dates.json");
  return res.json();
}
async function fetchLeagueScores(leagueId) { return authedFetch(`/api/leagues/${leagueId}/scores`); }
async function fetchMyLeagues() { return authedFetch("/api/leagues/mine"); }
async function fetchMyWeek(leagueId, week) { return authedFetch(`/api/leagues/${leagueId}/my-week?week=${week}`); }
async function fetchLeagueStats(leagueId) { return authedFetch(`/api/leagues/${leagueId}/stats`); }
async function fetchSeasonHistory(leagueId, year) { return authedFetch(`/api/leagues/${leagueId}/seasons/${year}`); }
async function fetchLeagueSeasons(leagueId) { return authedFetch(`/api/leagues/${leagueId}/seasons`); }
async function fetchLeagueDetail(leagueId) { return authedFetch(`/api/leagues/${leagueId}`); }
async function markMessageBoardRead(leagueId) { return authedFetch(`/api/leagues/${leagueId}/posts/read`, { method: "POST" }); }

function formatLocalTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZoneName: "short",
  }).format(new Date(isoString));
}

async function getCurrentWeek() {
  const datesData = await fetchDates();
  // Real wall-clock time, not the backend poller's last-run timestamp — the
  // cutoff below (each week's latest game date + 1 day, i.e. the Tuesday
  // after Monday Night Football) needs to compare against "right now" for
  // every visitor, not against whenever the score poller last happened to run.
  const currentDate = new Date();
  let currentWeek = 1;
  for (let i = 0; i < datesData.length; i++) {
    const week = datesData[i];
    const gameDates = Object.values(week)
      .filter((v) => typeof v === "string" && /^\d{8}$/.test(v))
      .map((dateStr) => {
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10) - 1;
        const day = parseInt(dateStr.substring(6, 8), 10);
        return new Date(year, month, day);
      });
    const latest = new Date(Math.max(...gameDates.map((d) => d.getTime())));
    const cutoff = new Date(latest);
    cutoff.setDate(cutoff.getDate() + 1);
    if (currentDate >= cutoff && i + 1 < datesData.length) {
      currentWeek = datesData[i + 1].week;
    }
  }
  return currentWeek;
}

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
function getLogoPath(team) {
  const mascot = team.split(" ").pop();
  return `/logos/${teamLogoMap[mascot] || "default.png"}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  initHeaderMenu();
  initThemeSwitcher();

  // --- Week rail collapse (desktop only — CSS hides the toggle and
  // reverts to a fixed horizontal strip on mobile). Collapsing is pure
  // CSS (width transition on .week-rail; .main-col is flex:1 so it grows
  // to fill the freed space), the JS just flips the class + arrow.
  const weekRail = document.getElementById("week-rail");
  const weekRailToggle = document.getElementById("week-rail-toggle");
  const weekRailToggleArrow = document.getElementById("week-rail-toggle-arrow");
  weekRailToggle.addEventListener("click", () => {
    const collapsed = weekRail.classList.toggle("collapsed");
    weekRailToggleArrow.textContent = collapsed ? "›" : "‹";
    weekRailToggle.setAttribute("aria-label", collapsed ? "Expand week selector" : "Collapse week selector");
    weekRailToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  // --- Nav (both rail and bar exist in the DOM; CSS shows only one per
  // breakpoint, but both sets of buttons must stay in sync so switching
  // works correctly if the viewport is resized between clicks)
  const navButtons = document.querySelectorAll("[data-tab]");
  const sections = document.querySelectorAll(".tab-section");
  const weekButtonsContainer = document.getElementById("week-buttons");
  const leaderboardTitle = document.getElementById("leaderboard-title");
  const picksTitle = document.getElementById("picks-title");
  const myWeekTitle = document.getElementById("my-week-title");
  const lastUpdatedTimeEls = document.querySelectorAll(".last-updated-time");
  const playerSelect = document.getElementById("select-player");
  const teamSelect = document.getElementById("select-team");
  const weeklyGrid = document.getElementById("weekly-picks-grid");
  const counterEl = document.getElementById("team-pick-counter");
  const toggleScoresBtn = document.getElementById("toggle-scores-btn");
  const matchupsContainer = document.getElementById("matchups-container");
  const matchupsList = document.getElementById("matchups-list");
  const toggleOddsBtn = document.getElementById("toggle-odds-btn");
  // Remembered per-device (not per-league/account) — a display preference
  // like this is about how the person wants their own screen to look, not
  // data tied to who's logged in, so plain localStorage is enough; no need
  // to round-trip it through the server the way league/picks data does.
  let showOdds = localStorage.getItem("pick5_showOdds") === "true";
  const toggleMinimalBtn = document.getElementById("toggle-minimal-btn");
  let minimalView = localStorage.getItem("pick5_minimalView") === "true";
  toggleOddsBtn.checked = showOdds;
  toggleMinimalBtn.checked = minimalView;
  // Just the checkbox + panel visibility here, not the panel's actual
  // content — currentWeek isn't known yet this early in startup. Content
  // fills in on its own once the Picks tab is actually loaded, since
  // loadWeeklyPicks() already re-renders the matchups list on every call
  // whenever the panel isn't hidden (see its own body further down).
  const showMatchups = localStorage.getItem("pick5_showMatchups") === "true";
  toggleScoresBtn.checked = showMatchups;
  matchupsContainer.classList.toggle("hidden", !showMatchups);

  const userName = document.getElementById("user-name");
  const userAvatar = document.getElementById("user-avatar");
  // scoresData isn't loaded yet at this point, so this just guards against a
  // broken/expired URL later — the initial src (default avatar) already
  // covers the "nothing loaded yet" gap, and the scores loader below (the
  // ".nav-avatar" forEach) is what actually sets each nav-avatar's real photo.
  userAvatar.onerror = () => { userAvatar.src = DEFAULT_AVATAR; };
  const settingsBtn = document.getElementById("settings-btn");
  const logoutBtn = document.getElementById("logout-btn");

  const leagueShortcut = document.getElementById("league-shortcut");
  const leagueSelect = document.getElementById("league-select");

  const howToPlayBtn = document.getElementById("how-to-play-btn");
  const howToPlayModal = document.getElementById("how-to-play-modal");
  const closeHowToPlay = document.getElementById("close-how-to-play");

  const lastUpdatedBtn = document.getElementById("last-updated-btn");
  const lastUpdatedModal = document.getElementById("last-updated-modal");
  const closeLastUpdated = document.getElementById("close-last-updated");


  const messageBoardBtn = document.getElementById("message-board-btn");
  const messageBoardModal = document.getElementById("message-board-modal");
  const messageBoardTitle = document.getElementById("message-board-title");
  const closeMessageBoard = document.getElementById("close-message-board");
  const postForm = document.getElementById("post-form");
  const postBody = document.getElementById("post-body");
  const postBodyCounter = document.getElementById("post-body-counter");
  const postSendBtn = document.getElementById("post-send-btn");
  const postsList = document.getElementById("posts-list");
  const menuTriggerDot = document.getElementById("menu-trigger-dot");
  const messageBoardDot = document.getElementById("message-board-dot");
  const POST_BODY_MAX_LEN = 250;

  const leagueStatsBtn = document.getElementById("league-stats-btn");
  const leagueStatsModal = document.getElementById("league-stats-modal");
  const leagueStatsTitle = document.getElementById("league-stats-title");
  const closeLeagueStats = document.getElementById("close-league-stats");
  const statsTabSeason = document.getElementById("stats-tab-season");
  const statsTabHof = document.getElementById("stats-tab-hof");
  const statsSeasonPanel = document.getElementById("stats-season-panel");
  const statsHofPanel = document.getElementById("stats-hof-panel");
  const statsSeasonBody = document.getElementById("stats-season-body");
  const hofYearSelect = document.getElementById("hof-year-select");
  const hofLoadBtn = document.getElementById("hof-load-btn");
  const hofAwards = document.getElementById("hof-awards");

  const myWeekPicksList = document.getElementById("my-week-picks-list");
  const myWeekPicksTotal = document.getElementById("my-week-picks-total");
  const myWeekProfilePic = document.getElementById("my-week-profile-pic");
  const myWeekName = document.getElementById("my-week-name");
  const myWeekTotalPoints = document.getElementById("my-week-total-points");
  const myWeekOverallPos = document.getElementById("my-week-overall-pos");
  const myWeekWinChance = document.getElementById("my-week-win-chance");
  const myWeekMostPicked = document.getElementById("my-week-most-picked");
  const myWeekOnYourHeels = document.getElementById("my-week-on-your-heels");
  const myWeekTrendChart = document.getElementById("my-week-trend-chart");

  const leaderboardPodium = document.getElementById("leaderboard-podium");
  const leaderboardList = document.getElementById("leaderboard-list");

  const settingsModal = document.getElementById("settings-modal");
  const settingsTitle = document.getElementById("settings-title");
  const closeSettings = document.getElementById("close-settings");
  const settingsForm = document.getElementById("settings-form");
  const displayNameInput = document.getElementById("display-name");
  const profileUrlInput = document.getElementById("profile-url");
  const leaguePhotoPicker = document.getElementById("league-photo-picker");

  const themeBtn = document.getElementById("theme-btn");
  const themeModal = document.getElementById("theme-modal");
  const closeTheme = document.getElementById("close-theme");

  let currentTab = "leaderboard";
  let currentWeek = null;
  let scoresData = {};
  let allPlayers = [];
  let loggedInUser = null;
  let myLeagues = [];
  let currentLeagueId = localStorage.getItem("pick5_currentLeagueId") || null;
  let isLeagueOwner = false;

  // =========================
  // Modals — centered M3 dialogs (not anchored popovers); only one open
  // at a time, click-outside or the X closes it.
  // =========================
  const allModals = [howToPlayModal, lastUpdatedModal, messageBoardModal, leagueStatsModal, settingsModal, themeModal];
  function closeAllModals() {
    allModals.forEach((m) => m.classList.add("hidden"));
  }
  function openModal(modal, onOpen) {
    closeAllModals();
    modal.classList.remove("hidden");
    if (onOpen) onOpen();
  }
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) closeAllModals();
  });

  // Delegated (not wired per-render) since these images live in the
  // leaderboard table, the podium, and the picks grid — all rebuilt from
  // scratch on every render — so one listener here covers every profile
  // pic that ever exists rather than re-attaching handlers each time.
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".leaderboard-mini-pic, .podium-avatar, .profile-pic");
    if (img) openLightbox(img.src, img.alt);
  });

  // =========================
  // Auth
  // =========================
  // Safety net: if onAuthStateChanged itself never fires (seen in the wild
  // during a Firebase Auth outage/rate-limit), the page would otherwise sit
  // on the loading overlay forever with no explanation.
  let authResolved = false;
  const authTimeoutId = setTimeout(() => {
    if (authResolved) return;
    // See auth-recovery.js — a stuck IndexedDB read (known Safari bug) is
    // the usual cause of this timer ever firing. First time in this browser
    // session, try to clear it and reload automatically; only fall back to
    // the manual message if that already happened and we're stuck again.
    if (attemptAuthStallRecovery()) return;
    document.getElementById("page-loading-overlay")?.classList.add("hidden");
    showToast("Your browser's storage got stuck — a known Safari/iOS bug that a refresh can't fix. Please fully close this tab or app and reopen it.", "error", 10000);
  }, 5000);

  onAuthStateChanged(auth, async (user) => {
    authResolved = true;
    clearTimeout(authTimeoutId);
    clearAuthStallRecoveryFlag();
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    let name = user.displayName || user.email || "User";
    try {
      const profile = await authedFetch("/api/profile/me");
      if (profile.displayName) name = profile.displayName;
    } catch (err) {
      console.error("Error loading profile:", err);
    }
    loggedInUser = name;
    userName.textContent = name;

    // The individual buttons live inside #header-menu now (see the
    // hamburger dropdown), which itself starts hidden — only the trigger
    // needs its own auth-gated visibility.
    document.getElementById("menu-trigger").style.display = "inline-flex";
    leagueShortcut.style.display = "flex";

    logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.reload();
    };

    await loadMyLeagues();
    document.getElementById("page-loading-overlay")?.classList.add("hidden");
  });

  async function loadMyLeagues() {
    try {
      myLeagues = await fetchMyLeagues();
    } catch (err) {
      console.error("Error loading leagues:", err);
      // Distinct from the real "you have zero leagues" case below — that
      // one correctly redirects to leagues.html, but a failed/timed-out
      // request isn't the same thing and shouldn't yank someone off their
      // dashboard just because of a network hiccup.
      showToast("Trouble loading your leagues. Please refresh the page.", "error");
      return;
    }
    if (myLeagues.length === 0) {
      window.location.href = "leagues.html";
      return;
    }
    if (!myLeagues.find((l) => l.id === currentLeagueId)) {
      currentLeagueId = myLeagues[0].id;
    }
    setCurrentLeague(currentLeagueId);
    refreshHeaderName();
    isLeagueOwner = myLeagues.find((l) => l.id === currentLeagueId)?.role === "owner";
    if (redirectToPicksIfNotSubmitted()) return;

    leagueSelect.innerHTML = "";
    myLeagues.forEach((league) => {
      const opt = document.createElement("option");
      opt.value = league.id;
      opt.textContent = league.name;
      leagueSelect.appendChild(opt);
    });
    leagueSelect.value = currentLeagueId;
    updateUnreadIndicator();

    showSection(currentTab);
  }

  function setCurrentLeague(leagueId) {
    currentLeagueId = leagueId;
    if (leagueId) localStorage.setItem("pick5_currentLeagueId", leagueId);
    else localStorage.removeItem("pick5_currentLeagueId");
  }

  // The header identity is per-league (same account can go by a different
  // name in different leagues), not the global profile name — re-fetch it
  // whenever the active league changes. Falls back to whatever's already
  // shown (the global name) if the lookup fails; never leaves it blank.
  async function refreshHeaderName() {
    if (!currentLeagueId) return;
    try {
      const league = await fetchLeagueDetail(currentLeagueId);
      const me = league.members.find((m) => m.uid === auth.currentUser?.uid);
      if (me?.displayName) {
        loggedInUser = me.displayName;
        userName.textContent = me.displayName;
      }
    } catch (err) {
      console.error("Error loading per-league display name:", err);
    }
  }

  // Reflects the currently-selected league's hasUnread flag (from
  // /api/leagues/mine) onto both the hamburger trigger and the Message
  // Board menu item.
  function updateUnreadIndicator() {
    const hasUnread = myLeagues.find((l) => l.id === currentLeagueId)?.hasUnread || false;
    menuTriggerDot.classList.toggle("hidden", !hasUnread);
    messageBoardDot.classList.toggle("hidden", !hasUnread);
  }

  // Picks must be fully submitted before any dashboard tab is useful (scores
  // are all zero and My Week is empty until then) — send the user to the
  // actual picks-submission page instead of showing an empty dashboard.
  function redirectToPicksIfNotSubmitted() {
    const league = myLeagues.find((l) => l.id === currentLeagueId);
    if (league && !league.submitted) {
      window.location.href = "picks.html";
      return true;
    }
    return false;
  }

  leagueSelect.addEventListener("change", () => {
    setCurrentLeague(leagueSelect.value);
    refreshHeaderName();
    isLeagueOwner = myLeagues.find((l) => l.id === currentLeagueId)?.role === "owner";
    if (redirectToPicksIfNotSubmitted()) return;
    updateUnreadIndicator();
    showSection(currentTab);
  });

  // =========================
  // How to Play
  // =========================
  howToPlayBtn.onclick = () => openModal(howToPlayModal);
  closeHowToPlay.onclick = () => closeAllModals();

  lastUpdatedBtn.onclick = () => openModal(lastUpdatedModal);
  closeLastUpdated.onclick = () => closeAllModals();


  // =========================
  // Message board
  // =========================
  messageBoardBtn.onclick = () => {
    messageBoardTitle.textContent = myLeagues.find((l) => l.id === currentLeagueId)?.name || "League";
    openModal(messageBoardModal, loadPosts);

    // Clear immediately (don't wait on the network) — opening the board is
    // the "read" action regardless of whether the mark-read call succeeds,
    // and re-flagging on a failed request would just be confusing.
    menuTriggerDot.classList.add("hidden");
    messageBoardDot.classList.add("hidden");
    const league = myLeagues.find((l) => l.id === currentLeagueId);
    if (league) league.hasUnread = false;

    markMessageBoardRead(currentLeagueId).catch((err) => console.error("Error marking message board read:", err));
  };
  closeMessageBoard.onclick = () => closeAllModals();

  postBody.addEventListener("input", () => {
    const len = postBody.value.length;
    postBodyCounter.textContent = `${len}/${POST_BODY_MAX_LEN}`;
    postBodyCounter.classList.toggle("limit-reached", len >= POST_BODY_MAX_LEN);
    postSendBtn.disabled = postBody.value.trim().length === 0;
  });
  postBody.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!postSendBtn.disabled) postForm.requestSubmit();
    }
  });

  // Tapping any message reveals every message's timestamp at once (and
  // tapping again hides them all) — same behavior as iMessage. Desktop
  // additionally reveals a single message's timestamp on hover, handled
  // purely in CSS. Ignore taps on the delete button itself.
  postsList.addEventListener("click", (e) => {
    if (e.target.closest(".post-delete-btn")) return;
    postsList.classList.toggle("show-all-times");
  });

  async function loadPosts() {
    postsList.innerHTML = "<li>Loading...</li>";
    try {
      const [posts, seasonYear, league] = await Promise.all([
        authedFetch(`/api/leagues/${currentLeagueId}/posts`),
        getCachedSeasonYear(),
        fetchLeagueDetail(currentLeagueId),
      ]);
      // post.authorName is a snapshot from when that message was posted and
      // can go stale after a rename — always show the member's current name
      // instead, falling back to the snapshot if they've since left the league.
      const currentNameByUid = new Map(league.members.map((m) => [m.uid, m.displayName]));
      const me = auth.currentUser;
      postsList.innerHTML = "";
      if (posts.length === 0) {
        postsList.innerHTML = "<li class='no-posts'>No posts yet — say something!</li>";
      }
      // API returns newest-first; a chat-style board reads top-to-bottom
      // oldest-to-newest, with the latest message at the bottom.
      let lastDay = null;
      [...posts].reverse().forEach((post) => {
        const postDate = new Date(post.createdAt);
        if (!lastDay || !isSameDay(postDate, lastDay)) {
          const divider = document.createElement("li");
          divider.className = "post-date-divider";
          divider.textContent = formatDateDivider(postDate);
          postsList.appendChild(divider);
          lastDay = postDate;
        }

        const isMine = post.authorUid === me?.uid;
        const li = document.createElement("li");
        li.className = isMine ? "post-row own-message" : "post-row";

        if (!isMine) {
          const meta = document.createElement("div");
          meta.className = "post-meta";
          meta.textContent = currentNameByUid.get(post.authorUid) || post.authorName;
          li.appendChild(meta);
        }

        // Bubble + timestamp share this wrapper (not the whole row, which
        // also includes meta/delete) so the timestamp's vertical centering
        // is scoped to just the bubble's own height, regardless of whether
        // a name label above or a delete button below is also present.
        const bubbleAnchor = document.createElement("div");
        bubbleAnchor.className = "post-bubble-anchor";
        const body = document.createElement("div");
        body.className = "post-body-text";
        body.textContent = post.body;
        bubbleAnchor.appendChild(body);

        // Hidden by default — revealed on hover (desktop) or, on any tap
        // anywhere in the board, all of these toggle on/off together (see
        // the postsList click listener below).
        const timeSide = document.createElement("div");
        timeSide.className = "post-time-side";
        timeSide.textContent = formatPostTime(post.createdAt, seasonYear);
        bubbleAnchor.appendChild(timeSide);

        li.appendChild(bubbleAnchor);
        if (isLeagueOwner || isMine) {
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "post-delete-btn";
          deleteBtn.textContent = "Delete";
          deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
              await authedFetch(`/api/leagues/${currentLeagueId}/posts/${post.id}`, { method: "DELETE" });
              await loadPosts();
            } catch (err) {
              showToast("Error deleting post: " + err.message, "error");
            }
          };
          li.appendChild(deleteBtn);
        }

        postsList.appendChild(li);
      });
      postsList.scrollTop = postsList.scrollHeight;
    } catch (err) {
      postsList.innerHTML = `<li>Error loading posts: ${err.message}</li>`;
    }
  }

  postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Disable synchronously, before the request even starts — the handler
    // is async, so without this a second Enter/click fired while the first
    // POST is still in flight would sail through (postSendBtn.disabled was
    // only ever set true *after* the await) and double-post the message.
    if (postSendBtn.disabled) return;
    postSendBtn.disabled = true;
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
      showToast("Error posting: " + err.message, "error");
      postSendBtn.disabled = postBody.value.trim().length === 0;
    }
  });

  // =========================
  // League Stats / Hall of Fame
  // =========================
  leagueStatsBtn.onclick = () =>
    openModal(leagueStatsModal, async () => {
      leagueStatsTitle.textContent = myLeagues.find((l) => l.id === currentLeagueId)?.name || "League";
      switchStatsTab("season");
      await loadSeasonStats();
    });
  closeLeagueStats.onclick = () => closeAllModals();

  function switchStatsTab(which) {
    statsTabSeason.classList.toggle("active", which === "season");
    statsTabHof.classList.toggle("active", which === "hof");
    statsSeasonPanel.classList.toggle("hidden", which !== "season");
    statsHofPanel.classList.toggle("hidden", which !== "hof");
  }
  statsTabSeason.onclick = async () => { switchStatsTab("season"); await loadSeasonStats(); };
  statsTabHof.onclick = async () => { switchStatsTab("hof"); await populateHofYears(); };

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

  // Hall of Fame "trophy case" — a card per award category, styled from the
  // app's own theme palette (see dashboard.css) instead of the old flat
  // label/value list.
  function hofCard({ icon, title, lines, champion }) {
    const body = lines.length
      ? lines.map((l) => `
          <div class="hof-line">
            <div class="hof-name-wrap">
              <span class="hof-name">${l.name}</span>
              ${l.sub ? `<span class="hof-sub">${l.sub}</span>` : ""}
            </div>
            <span class="hof-chip">${l.chip}</span>
          </div>
        `).join("")
      : `<p class="hof-empty">Nobody yet this season.</p>`;
    // Only Champion gets an icon badge — the rest read as a plain title now.
    return `
      <div class="hof-card${champion ? " hof-champion" : ""}">
        <div class="hof-card-head">
          ${champion ? `<span class="hof-icon-badge">${icon}</span>` : ""}
          <span class="hof-card-title">${title}</span>
        </div>
        ${body}
      </div>
    `;
  }

  // One self-contained line per tied player, rather than stacking bare names
  // with one shared stat at the end — matters for awards like Highest
  // Scoring Week, where two players can each own the top score but in
  // different weeks.
  function hofLines(award, formatLine) {
    return award ? award.players.map((p) => formatLine(p, award.best)) : [];
  }

  hofLoadBtn.onclick = async () => {
    hofAwards.innerHTML = "<p>Loading...</p>";
    try {
      const s = await fetchSeasonHistory(currentLeagueId, hofYearSelect.value);
      hofAwards.innerHTML = [
        hofCard({
          icon: HOF_ICON_TROPHY, title: "Champion", champion: true,
          lines: hofLines(s.champion, (p, best) => ({ name: p.name, chip: `${best.toLocaleString()} pts` })),
        }),
        hofCard({
          title: "Highest Scoring Week",
          lines: hofLines(s.highestScoringWeek, (p, best) => ({ name: p.name, sub: p.week.replace("week", "Week "), chip: `${best} pts` })),
        }),
        hofCard({
          title: "Longest Win Streak",
          lines: hofLines(s.longestWinStreak, (p, best) => ({ name: p.name, chip: `${best} week${best === 1 ? "" : "s"}` })),
        }),
        hofCard({
          title: "Most Weeks Won",
          lines: hofLines(s.mostWeeksWon, (p, best) => ({ name: p.name, chip: `${best} week${best === 1 ? "" : "s"}` })),
        }),
        hofCard({
          title: "Most Bonuses Won",
          lines: hofLines(s.mostBonusesWon, (p, best) => ({ name: p.name, chip: `${best} bonus${best === 1 ? "" : "es"}` })),
        }),
        hofCard({
          title: "Most Ties",
          lines: hofLines(s.mostTies, (p, best) => ({ name: p.name, chip: `${best} week${best === 1 ? "" : "s"}` })),
        }),
      ].join("");
    } catch (err) {
      hofAwards.innerHTML = `<p>${err.message}</p>`;
    }
  };

  // =========================
  // Settings
  // =========================
  settingsBtn.onclick = () =>
    openModal(settingsModal, async () => {
      settingsTitle.textContent = myLeagues.find((l) => l.id === currentLeagueId)?.name || "League";
      displayNameInput.value = "";
      profileUrlInput.value = "";
      let currentPhotoURL = null;
      try {
        const league = await fetchLeagueDetail(currentLeagueId);
        const me = league.members.find((m) => m.uid === auth.currentUser?.uid);
        displayNameInput.value = me?.displayName || "";
        currentPhotoURL = me?.photoURL || null;
      } catch (err) {
        console.error("Error loading league member profile:", err);
      }
      initPhotoPicker(leaguePhotoPicker, { onSelect: (url) => { profileUrlInput.value = url; }, currentPhotoURL });
    });
  closeSettings.onclick = () => closeAllModals();

  themeBtn.onclick = () => openModal(themeModal);
  closeTheme.onclick = () => closeAllModals();

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!auth.currentUser) return showToast("You must be logged in.", "error");
    try {
      const update = {};
      if (displayNameInput.value) update.displayName = displayNameInput.value;
      if (profileUrlInput.value) update.photoURL = profileUrlInput.value;
      await authedFetch(`/api/leagues/${currentLeagueId}/members/me`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      showToast("Profile updated for this league!", "success");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      showToast("Error updating profile: " + err.message, "error");
    }
  });

  // =========================
  // Nav (rail + bar) — tab switching
  // =========================
  async function showSection(tab) {
    // Switching tabs hides the My Week section outright without the mouse
    // ever actually leaving a hovered trend-chart dot, so no mouseleave
    // fires — without this, a stuck tooltip from My Week would keep
    // floating on top of whichever tab you switch to next.
    trendTooltipEl?.classList.add("hidden");

    currentTab = tab;
    // Leaderboard used to default to "Overall" — now opens on the current
    // week instead, same week getCurrentWeek() already picks for Picks/My
    // Week (games' latest date + 1 day, i.e. the Tuesday after Monday
    // Night Football). "Overall" is still one tap away via its own chip.
    currentWeek = await getCurrentWeek();

    sections.forEach((section) => section.classList.toggle("hidden", section.id !== `${tab}-section`));
    // .dashboard-main is the scroll container (overflow-y: auto), not the
    // window — switching tabs doesn't reset it on its own, so a section
    // scrolled down before switching would leave the newly-shown tab
    // starting mid-page instead of at the top.
    document.querySelector(".dashboard-main")?.scrollTo(0, 0);
    navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));

    renderWeekButtons();
    updateTitles();

    if (!currentLeagueId) {
      if (tab === "leaderboard") {
        leaderboardPodium.innerHTML = "";
        leaderboardList.innerHTML = `<tr><td colspan="3">No league selected — create or join one from the Leagues screen.</td></tr>`;
      }
      if (tab === "picks") {
        weeklyGrid.innerHTML = `<p>No league selected — create or join one from the Leagues screen.</p>`;
      }
      if (tab === "my-week") {
        myWeekPicksList.innerHTML = "";
        myWeekPicksTotal.textContent = "";
        myWeekMostPicked.innerHTML = "";
        myWeekOnYourHeels.innerHTML = "";
        myWeekTrendChart.innerHTML = "";
        myWeekWinChance.innerHTML = `<span class="my-week-win-chance-label">No league selected</span>`;
      }
      return;
    }

    try {
      const scoresArray = DEMO_LEADERBOARD ? DEMO_SCORES : await fetchLeagueScores(currentLeagueId);
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
      console.error("Error loading scores:", err);
      scoresData = {};
    }

    const myUid = auth.currentUser?.uid;
    if (myUid && scoresData[myUid]) {
      document.querySelectorAll(".nav-avatar").forEach((img) => { img.src = scoresData[myUid].photoURL; });
    }

    if (tab === "picks") {
      loadPlayers();
      loadTeamsDropdown();
      loadWeeklyPicks(currentWeek);
      const btn = Array.from(weekButtonsContainer.children).find((b) => Number(b.dataset.week) === currentWeek);
      if (btn) {
        setActiveWeekButton(btn);
        btn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      }
    }
    if (tab === "leaderboard") {
      loadLeaderboard();
      const btn = Array.from(weekButtonsContainer.children).find((b) => Number(b.dataset.week) === currentWeek);
      if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
    if (tab === "my-week") loadMyWeek(currentWeek);
  }

  navButtons.forEach((btn) => btn.addEventListener("click", () => showSection(btn.dataset.tab)));

  // =========================
  // Week chips
  // =========================
  function renderWeekButtons() {
    weekButtonsContainer.innerHTML = "";

    if (currentTab === "leaderboard") {
      const overallBtn = document.createElement("button");
      overallBtn.type = "button";
      overallBtn.textContent = "Overall";
      overallBtn.className = "m3-chip week-chip";
      overallBtn.addEventListener("click", () => {
        currentWeek = null;
        updateTitles();
        setActiveWeekButton(overallBtn);
        loadLeaderboard();
      });
      weekButtonsContainer.appendChild(overallBtn);
      if (currentWeek === null) setActiveWeekButton(overallBtn);
    }

    for (let i = 1; i <= 18; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `Week ${i}`;
      btn.className = "m3-chip week-chip";
      btn.dataset.week = i;
      btn.disabled = currentTab === "my-week";
      btn.addEventListener("click", () => {
        currentWeek = i;
        updateTitles();
        setActiveWeekButton(btn);
        if (currentTab === "picks") loadWeeklyPicks(currentWeek);
        if (currentTab === "leaderboard") loadLeaderboard();
        if (currentTab === "my-week") loadMyWeek(currentWeek);
        btn.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      });
      weekButtonsContainer.appendChild(btn);
      if (i === currentWeek) setActiveWeekButton(btn);
    }
  }

  function updateTitles() {
    if (currentTab === "leaderboard") {
      leaderboardTitle.textContent = currentWeek === null ? "OVERALL LEADERBOARD" : `WEEK ${currentWeek} LEADERBOARD`;
    } else if (currentTab === "picks") {
      picksTitle.textContent = `WEEK ${currentWeek} PICKS`;
    } else if (currentTab === "my-week") {
      myWeekTitle.textContent = `MY WEEK ${currentWeek}`;
    }
  }

  function setActiveWeekButton(activeBtn) {
    weekButtonsContainer.querySelectorAll(".week-chip").forEach((btn) => btn.classList.remove("selected"));
    if (activeBtn) activeBtn.classList.add("selected");
  }

  // =========================
  // Leaderboard
  // =========================
  async function loadLeaderboard() {
    leaderboardPodium.innerHTML = "";
    leaderboardList.innerHTML = "";

    let anyGameCompleted = false;
    try {
      const gamesData = await fetchGames();
      const relevantWeeks = currentWeek === null ? gamesData : gamesData.filter((g) => g.week === currentWeek);
      anyGameCompleted = relevantWeeks.some((g) => (g.games || []).some((game) => game.status === "Completed"));
    } catch (err) {
      console.error("Error loading games for leaderboard:", err);
    }

    const players = Object.entries(scoresData).map(([uid, player]) => {
      const score = currentWeek === null ? player.overall_score : player.weeks?.[`week${currentWeek}`]?.total ?? 0;
      return { uid, name: player.name, score, photoURL: player.photoURL || DEFAULT_AVATAR };
    });

    players.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.name.localeCompare(b.name)));

    if (!anyGameCompleted) {
      // Nobody's actually played yet, so a "1st place" tie across the
      // whole league at 0 points doesn't mean anything — skip the podium
      // and list everyone with no position instead of implying a ranking
      // that hasn't happened.
      players.forEach((player) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>-</td>
          <td class="leaderboard-player-cell">
            <img src="${player.photoURL}" alt="${player.name}" class="leaderboard-mini-pic">
            <span>${player.name}</span>
          </td>
          <td>${player.score}</td>
        `;
        leaderboardList.appendChild(tr);
      });
      return;
    }

    let currentRank = 0, prevScore = null, playersSeen = 0;
    const ranked = players.map((player) => {
      playersSeen++;
      if (player.score !== prevScore) currentRank = playersSeen;
      prevScore = player.score;
      return { ...player, rank: currentRank };
    });

    function buildPodiumRow(rank, tiedPlayers) {
      const row = document.createElement("div");
      // Past 3 tied players the pill's full stadium radius stretches into a
      // blobby oval around the wrapped rows — switch to a rounded-rect
      // shape and cap+scroll instead of letting it grow indefinitely.
      const crowded = tiedPlayers.length > 3 ? " podium-row-crowded" : "";
      row.className = `podium-row podium-rank-${rank}${crowded}`;
      row.innerHTML = `
        <span class="podium-rank-num">${rank}</span>
        <div class="podium-players">
          ${tiedPlayers.map((player) => `
            <div class="podium-player">
              <img src="${player.photoURL}" alt="${player.name}" class="podium-avatar">
              <div class="podium-info">
                <span class="podium-name">${player.name}</span>
                <span class="podium-score">${player.score} pts</span>
              </div>
            </div>`).join("")}
        </div>`;
      return row;
    }

    // Classic podium shape: 1st spans the full width on its own row; 2nd
    // and 3rd share a row side by side underneath. Either can be missing
    // (a tie for 1st skips rank 2 entirely, e.g.) — each row only renders
    // if it has a rank to show.
    // A 0-pt player never belongs on the podium, even if 0 happens to be
    // the best (or tied-best) score in the league right now — a "1st place"
    // trophy for zero points reads as an actual accomplishment it isn't.
    // They fall through to the plain list below instead, same as anyone
    // ranked below 3rd.
    const rank1Players = ranked.filter((p) => p.rank === 1 && p.score > 0);
    if (rank1Players.length) {
      const topRow = document.createElement("div");
      topRow.className = "podium-top-row";
      topRow.appendChild(buildPodiumRow(1, rank1Players));
      leaderboardPodium.appendChild(topRow);
    }

    const rank2Players = ranked.filter((p) => p.rank === 2 && p.score > 0);
    const rank3Players = ranked.filter((p) => p.rank === 3 && p.score > 0);
    if (rank2Players.length || rank3Players.length) {
      const bottomRow = document.createElement("div");
      bottomRow.className = "podium-bottom-row";
      if (rank2Players.length) bottomRow.appendChild(buildPodiumRow(2, rank2Players));
      if (rank3Players.length) bottomRow.appendChild(buildPodiumRow(3, rank3Players));
      leaderboardPodium.appendChild(bottomRow);
    }

    const rest = ranked.filter((p) => p.rank > 3 || p.score === 0);
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

    fitPodiumNames();
  }

  // Desktop only ("keep mobile as is") — starts each podium name at its big
  // CSS-defined size (see the min-width:841px block in dashboard.css) and
  // shrinks only that specific name down as far as it individually needs to
  // avoid overflowing its pill, so a short name stays huge and only a long
  // one gives up size. Always resets first: without that, resizing a window
  // from desktop down to mobile would leave a previous run's shrunk inline
  // font-size stuck on top of mobile's own (smaller, fixed) CSS size.
  const PODIUM_NAME_MIN_FONT_PX = 14;
  function fitPodiumNames() {
    const names = document.querySelectorAll(".podium-name");
    names.forEach((label) => { label.style.fontSize = ""; });
    if (window.innerWidth <= 840) return;
    names.forEach((label) => shrinkFontToFit(label, PODIUM_NAME_MIN_FONT_PX));
  }

  // =========================
  // My Week
  // =========================
  async function loadMyWeek(week) {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;

    const me = scoresData[myUid];
    myWeekProfilePic.src = me?.photoURL || DEFAULT_AVATAR;
    myWeekName.textContent = me?.name || loggedInUser || "You";
    myWeekTotalPoints.textContent = `${me?.overall_score ?? 0} pts`;

    const ranked = Object.entries(scoresData).map(([uid, p]) => ({ uid, overall: p.overall_score })).sort((a, b) => b.overall - a.overall);
    const myRankIndex = ranked.findIndex((p) => p.uid === myUid);

    // Competition ranking (1224), matching the leagues list — tied players
    // share the rank they're tied for, marked with a "T-" prefix.
    let myRank = null, myRankTied = false;
    if (myRankIndex >= 0) {
      let currentRank = 0, prevOverall = null;
      for (let i = 0; i <= myRankIndex; i++) {
        if (ranked[i].overall !== prevOverall) currentRank = i + 1;
        prevOverall = ranked[i].overall;
      }
      myRank = currentRank;
      myRankTied = ranked.filter((p) => p.overall === ranked[myRankIndex].overall).length > 1;
    }

    myWeekOverallPos.innerHTML = myRank
      ? `<span class="my-week-overall-pos-rank">${myRankTied ? "T-" : ""}${ordinal(myRank)}</span><span class="my-week-overall-pos-label">of ${ranked.length} players</span>`
      : `<span class="my-week-overall-pos-label">Overall: --</span>`;

    // Closest trailing players — sorted descending, so the entries right
    // after me are already in closest-first order; just cap the gap and count.
    // Ties (gap of 0) are excluded — "behind" means strictly trailing, and a
    // stable sort can otherwise place a tied player after me by coincidence.
    const myOverall = myRankIndex >= 0 ? ranked[myRankIndex].overall : 0;
    // No cap here anymore — the list shows 5 rows at a time and scrolls
    // internally (see #my-week-on-your-heels in dashboard.css) instead of
    // truncating past a fixed count, so every qualifying player is reachable.
    // Explicitly sorted (smallest gap first, alphabetical to break ties) —
    // slicing straight from `ranked` happened to already read closest-first
    // for non-tied gaps, but left players tied on the same gap in whatever
    // arbitrary order Object.entries(scoresData) originally produced.
    const onYourHeels = myRankIndex >= 0
      ? ranked
          .slice(myRankIndex + 1)
          .filter((p) => myOverall - p.overall > 0 && myOverall - p.overall <= 50)
          .sort((a, b) => {
            const gapDiff = (myOverall - a.overall) - (myOverall - b.overall);
            if (gapDiff !== 0) return gapDiff;
            return (scoresData[a.uid]?.name || "").localeCompare(scoresData[b.uid]?.name || "");
          })
      : [];

    myWeekOnYourHeels.innerHTML = "";
    if (onYourHeels.length === 0) {
      myWeekOnYourHeels.innerHTML = "<li>There are no players within 50 points behind you!</li>";
    } else {
      onYourHeels.forEach((p) => {
        const player = scoresData[p.uid];
        const gap = myOverall - p.overall;
        const li = document.createElement("li");
        li.className = "pick-row";
        li.innerHTML = `
          <img src="${player?.photoURL || DEFAULT_AVATAR}" alt="${player?.name || ""}" class="heels-avatar">
          <span class="team-name">${player?.name || "Unknown"}</span>
          <span class="team-points">-${gap}</span>
        `;
        myWeekOnYourHeels.appendChild(li);
      });
    }

    myWeekPicksList.innerHTML = "<li>Loading...</li>";
    myWeekPicksTotal.textContent = "";
    myWeekMostPicked.innerHTML = "";
    myWeekWinChance.innerHTML = `<span class="my-week-win-chance-label">Calculating your chances...</span>`;

    try {
      const [myWeek, gamesData] = await Promise.all([fetchMyWeek(currentLeagueId, week), fetchGames()]);
      const gamesForWeek = gamesData.find((g) => g.week === week)?.games || [];
      const weekData = { teams: myWeek.teams || {}, total: myWeek.total ?? 0 };

      myWeekPicksList.innerHTML = "";
      if (!weekData.teams || Object.keys(weekData.teams).length === 0) {
        myWeekPicksList.innerHTML = "<li>No picks submitted</li>";
      } else {
        const bonusTeam = Object.entries(weekData.teams).find(([, info]) => info.bonus);
        const otherTeams = Object.entries(weekData.teams).filter(([, info]) => !info.bonus);
        otherTeams.sort(([a], [b]) => {
          const idxA = gamesForWeek.findIndex((g) => g.homeTeam === a || g.awayTeam === a);
          const idxB = gamesForWeek.findIndex((g) => g.homeTeam === b || g.awayTeam === b);
          return idxA - idxB;
        });

        const orderedTeams = [];
        if (bonusTeam) orderedTeams.push(bonusTeam);
        orderedTeams.push(...otherTeams);

        orderedTeams.forEach(([team, info]) => {
          const li = document.createElement("li");
          li.className = "pick-row";
          if (info.bonus) li.classList.add("bonus");

          const game = gamesForWeek.find((g) => g.homeTeam === team || g.awayTeam === team);
          let resultClass = "";
          if (game && game.status === "Completed") resultClass = info.points > 0 ? "win" : "loss";

          li.innerHTML = `
            <img src="${getLogoPath(team)}" alt="${team}" class="team-logo">
            <span class="team-name ${resultClass}">${team}</span>
            <span class="team-points">${info.points}</span>
          `;
          myWeekPicksList.appendChild(li);
        });
      }
      myWeekPicksTotal.textContent = `Total: ${weekData.total ?? 0}`;

      myWeekMostPicked.innerHTML = "";
      if (!myWeek.mostPickedTeams || myWeek.mostPickedTeams.length === 0) {
        myWeekMostPicked.innerHTML = "<li>No picks submitted yet this week</li>";
      }
      (myWeek.mostPickedTeams || []).forEach(({ team, count }) => {
        const li = document.createElement("li");
        li.className = "pick-row";
        if (weekData.teams[team]) li.classList.add("highlighted");
        li.innerHTML = `
          <img src="${getLogoPath(team)}" alt="${team}" class="team-logo">
          <span class="team-name">${team}</span>
          <span class="team-points">${count} player${count === 1 ? "" : "s"}</span>
        `;
        myWeekMostPicked.appendChild(li);
      });

      myWeekWinChance.innerHTML = `
        <div class="my-week-chance-stat">
          <span class="my-week-win-chance-pct">${myWeek.winChancePct}%</span>
          <span class="my-week-win-chance-label">chance to win the week</span>
        </div>
        <div class="my-week-chance-stat my-week-chance-stat-top3">
          <span class="my-week-win-chance-pct">${myWeek.top3ChancePct}%</span>
          <span class="my-week-win-chance-label">chance of a top-3 finish</span>
        </div>
      `;

      renderSeasonTrend(myUid, gamesData);
    } catch (err) {
      console.error("Error loading my-week:", err);
      myWeekPicksList.innerHTML = "<li>Error loading this week's data</li>";
      myWeekPicksTotal.textContent = "";
      myWeekWinChance.innerHTML = "";
    }
  }

  // Basic breakdown behind the "chance to win the week" stat — one row per
  // Weekly points + weekly overall rank, plotted as two lines across every
  // week that's had at least one completed game so far. Computed entirely
  // from scoresData (already fetched for the league) — no extra network call.
  function renderSeasonTrend(myUid, gamesData) {
    if (!scoresData[myUid]) {
      myWeekTrendChart.innerHTML = "";
      return;
    }

    const players = Object.keys(scoresData);
    const cumulative = {};
    players.forEach((uid) => { cumulative[uid] = 0; });

    const weeks = [];
    const pointsSeries = [];
    const rankSeries = [];
    const rankTiedSeries = [];

    for (let w = 1; w <= 18; w++) {
      const gamesForWeek = gamesData.find((g) => g.week === w)?.games || [];
      // A week's final score isn't real yet while any of its games are
      // still in progress — only plot it once every game in the week has
      // actually finished (i.e. once the next week has started), not the
      // moment the first game of the week wraps up.
      const weekFullyDecided = gamesForWeek.length > 0 && gamesForWeek.every((g) => g.status === "Completed");
      if (!weekFullyDecided) break;

      players.forEach((uid) => {
        cumulative[uid] += scoresData[uid].weeks?.[`week${w}`]?.total || 0;
      });

      // Competition ranking (1224), same as the "T-4th of 16 players" stat
      // above — tied players share the rank they're tied for. A plain
      // findIndex+1 here would instead spread tied players out across
      // distinct ranks in whatever order Object.keys(scoresData) happens to
      // return them, which reads as an arbitrary, wrong position (e.g. a
      // 4-way tie for 4th showing as 4th/5th/6th/7th depending on uid order).
      const rankedThroughWeek = players
        .map((uid) => ({ uid, total: cumulative[uid] }))
        .sort((a, b) => b.total - a.total);
      const myIndexThroughWeek = rankedThroughWeek.findIndex((p) => p.uid === myUid);
      let myRankThroughWeek = 0, currentRank = 0, prevTotal = null;
      for (let i = 0; i <= myIndexThroughWeek; i++) {
        if (rankedThroughWeek[i].total !== prevTotal) currentRank = i + 1;
        prevTotal = rankedThroughWeek[i].total;
      }
      myRankThroughWeek = currentRank;
      const myTotalThroughWeek = rankedThroughWeek[myIndexThroughWeek].total;
      const isTied = rankedThroughWeek.filter((p) => p.total === myTotalThroughWeek).length > 1;

      weeks.push(w);
      pointsSeries.push(scoresData[myUid].weeks?.[`week${w}`]?.total || 0);
      rankSeries.push(myRankThroughWeek);
      rankTiedSeries.push(isTied);
    }

    if (weeks.length === 0) {
      myWeekTrendChart.innerHTML = `<p class="my-week-trend-empty">No completed weeks yet. Check back later!</p>`;
      return;
    }

    myWeekTrendChart.innerHTML = buildTrendChart(weeks, pointsSeries, rankSeries, rankTiedSeries, players.length);
    wireTrendTooltips();
  }

  // Single shared tooltip element, reused for every dot — created lazily on
  // first hover rather than up front, since most page loads never touch it.
  let trendTooltipEl = null;
  let trendTooltipScrollHooked = false;
  function ensureTrendTooltip() {
    if (!trendTooltipEl) {
      trendTooltipEl = document.createElement("div");
      trendTooltipEl.className = "trend-tooltip hidden";
      document.body.appendChild(trendTooltipEl);
    }
    // The tooltip is position:fixed, placed once at hover-time from the
    // dot's on-screen rect — scrolling .dashboard-main (the actual scroll
    // container; see the note by its scrollTo(0,0) call above) moves the
    // dot without the mouse itself moving, so no mouseleave ever fires and
    // the tooltip is left floating over whatever's now under those fixed
    // coordinates. Hook this once, not per-render, since the container
    // itself persists across every re-render of the chart it scrolls.
    if (!trendTooltipScrollHooked) {
      trendTooltipScrollHooked = true;
      document.querySelector(".dashboard-main")?.addEventListener("scroll", () => {
        trendTooltipEl?.classList.add("hidden");
      });
      // Ground-truth watchdog, not another event listener — mouseenter/
      // mouseleave kept proving unreliable for closing this tooltip (still
      // stuck after hard-refreshing in two different browsers), so instead
      // of guessing at which specific event isn't firing, just track where
      // the cursor actually is and directly ask the DOM what's really under
      // it a few times a second. If that's not a hit circle, force-closed —
      // this can't get stuck no matter which underlying event was the
      // problem, since it never depends on one firing in the first place.
      let lastMouseX = -1, lastMouseY = -1;
      document.addEventListener("mousemove", (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      });
      setInterval(() => {
        if (!trendTooltipEl || trendTooltipEl.classList.contains("hidden")) return;
        const hovered = document.elementFromPoint(lastMouseX, lastMouseY);
        if (!hovered || !hovered.closest(".trend-dot-hit")) {
          trendTooltipEl.classList.add("hidden");
        }
      }, 150);
    }
    return trendTooltipEl;
  }

  // Attaches hover listeners to the invisible hit-target circles built into
  // the chart's SVG — called once per render, since the SVG is rebuilt from
  // scratch (via innerHTML) every time the trend chart updates.
  function wireTrendTooltips() {
    myWeekTrendChart.querySelectorAll(".trend-dot-hit").forEach((hit) => {
      hit.addEventListener("mouseenter", () => {
        const week = hit.dataset.week;
        const value = hit.dataset.value;
        const text = hit.dataset.kind === "points"
          ? `Week ${week}: ${value} pts`
          : `Week ${week}: ${hit.dataset.tied === "1" ? "T-" : ""}${ordinal(Number(value))}`;

        const tooltip = ensureTrendTooltip();
        tooltip.textContent = text;
        tooltip.classList.remove("hidden");
        const rect = hit.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top}px`;
      });
      hit.addEventListener("mouseleave", () => {
        trendTooltipEl?.classList.add("hidden");
      });
    });
  }

  // Evenly spaced tick values for the points axis (left) — 0, a midpoint,
  // and the max, rounded to whole points since fractional points don't
  // happen. For the rank axis (right), every rank if there are few enough
  // players to list without crowding, otherwise just top/middle/bottom.
  function pointsAxisTicks(maxPoints) {
    return [0, Math.round(maxPoints / 2), maxPoints];
  }
  function rankAxisTicks(totalPlayers) {
    if (totalPlayers <= 1) return [1];
    if (totalPlayers <= 4) return Array.from({ length: totalPlayers }, (_, i) => i + 1);
    return [1, Math.round((1 + totalPlayers) / 2), totalPlayers];
  }

  function buildTrendChart(weeks, pointsSeries, rankSeries, rankTiedSeries, totalPlayers) {
    const width = 320;
    const height = 190;
    // Left/right padding widened from the original 8px to leave room for
    // this chart's two y-axis labels (points on the left, rank on the
    // right) — everything else about the plot area is unchanged.
    const padL = 22, padR = 20, padT = 12, padB = 22;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = weeks.length;

    const maxPoints = Math.max(...pointsSeries, 10);
    const xFor = (i) => (n > 1 ? padL + (innerW * i) / (n - 1) : padL + innerW / 2);
    const yForPoints = (v) => padT + innerH * (1 - v / maxPoints);
    const yForRank = (v) => (totalPlayers > 1 ? padT + (innerH * (v - 1)) / (totalPlayers - 1) : padT + innerH / 2);

    const pointsPath = pointsSeries.map((v, i) => `${xFor(i)},${yForPoints(v)}`).join(" ");
    const rankPath = rankSeries.map((v, i) => `${xFor(i)},${yForRank(v)}`).join(" ");
    const pointsDots = pointsSeries.map((v, i) => `<circle class="trend-dot-points" cx="${xFor(i)}" cy="${yForPoints(v)}" r="3" />`).join("");
    const rankDots = rankSeries.map((v, i) => `<circle class="trend-dot-rank" cx="${xFor(i)}" cy="${yForRank(v)}" r="3" />`).join("");

    // Invisible, larger circles layered on top of the small visible dots —
    // a bare r=3 dot is a tiny, fiddly hover target, so hovering anywhere
    // within this wider radius shows that dot's tooltip instead.
    const pointsHits = pointsSeries
      .map((v, i) => `<circle class="trend-dot-hit" data-kind="points" data-week="${weeks[i]}" data-value="${v}" cx="${xFor(i)}" cy="${yForPoints(v)}" r="9" />`)
      .join("");
    const rankHits = rankSeries
      .map((v, i) => `<circle class="trend-dot-hit" data-kind="rank" data-week="${weeks[i]}" data-value="${v}" data-tied="${rankTiedSeries[i] ? "1" : "0"}" cx="${xFor(i)}" cy="${yForRank(v)}" r="9" />`)
      .join("");

    const labelStep = n > 9 ? 2 : 1;
    const xLabels = weeks
      .map((w, i) => (i % labelStep === 0 || i === n - 1
        ? `<text class="trend-axis-label" x="${xFor(i)}" y="${height - 6}" font-size="9" text-anchor="middle">${w}</text>`
        : ""))
      .join("");

    // Left axis (points): a vertical rule at padL, a small tick mark, and
    // the value right-aligned just to its left. Right axis (rank): mirror
    // image, left-aligned just to the right of its own vertical rule.
    const pointsY = pointsAxisTicks(maxPoints);
    const leftAxis = `
      <line class="trend-axis-line trend-axis-line-points" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" />
      ${pointsY.map((v) => `
        <line class="trend-axis-tick trend-axis-tick-points" x1="${padL - 3}" y1="${yForPoints(v)}" x2="${padL}" y2="${yForPoints(v)}" />
        <text class="trend-axis-tick-label trend-axis-tick-label-points" x="${padL - 5}" y="${yForPoints(v) + 3}" font-size="8" text-anchor="end">${v}</text>
      `).join("")}
    `;
    const rankX = width - padR;
    const rankTicksArr = rankAxisTicks(totalPlayers);
    const rightAxis = `
      <line class="trend-axis-line trend-axis-line-rank" x1="${rankX}" y1="${padT}" x2="${rankX}" y2="${padT + innerH}" />
      ${rankTicksArr.map((v) => `
        <line class="trend-axis-tick trend-axis-tick-rank" x1="${rankX}" y1="${yForRank(v)}" x2="${rankX + 3}" y2="${yForRank(v)}" />
        <text class="trend-axis-tick-label trend-axis-tick-label-rank" x="${rankX + 5}" y="${yForRank(v) + 3}" font-size="8" text-anchor="start">${v}</text>
      `).join("")}
    `;

    return `
      <svg viewBox="0 0 ${width} ${height}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
        ${leftAxis}
        ${rightAxis}
        <polyline class="trend-line-points" points="${pointsPath}" fill="none" stroke-width="2" />
        <polyline class="trend-line-rank" points="${rankPath}" fill="none" stroke-width="2" />
        ${pointsDots}
        ${rankDots}
        ${xLabels}
        ${pointsHits}
        ${rankHits}
      </svg>
      <div class="trend-legend">
        <span class="trend-legend-item"><span class="trend-swatch trend-swatch-points"></span>Points</span>
        <span class="trend-legend-item"><span class="trend-swatch trend-swatch-rank"></span>Position</span>
      </div>
    `;
  }

  // =========================
  // Players / Teams dropdowns
  // =========================
  function loadPlayers() {
    // Members who haven't submitted their season picks yet have no weeks
    // in scoresData at all (see submittedSeasonPicks server-side) — leave
    // them out of the picks tab entirely rather than showing an empty card.
    allPlayers = Object.entries(scoresData)
      .filter(([, player]) => Object.keys(player.weeks || {}).length > 0)
      .map(([uid, player]) => ({ uid, name: player.name }));
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
    Array.from(teamSet).sort().forEach((team) => {
      const opt = document.createElement("option");
      opt.value = team;
      opt.textContent = team;
      teamSelect.appendChild(opt);
    });
    teamSelect.value = "all";
  }

  // =========================
  // Picks grid
  // =========================
  async function loadWeeklyPicks(weekNumber) {
    weeklyGrid.innerHTML = "";
    // Minimal view abandons the card grid entirely for a dense single-column
    // table-style list (see .weekly-picks-grid.minimal-list in dashboard.css)
    // — a card per player, each with its own header/padding/shadow, is
    // exactly the kind of chrome-per-item overhead that eats screen space;
    // a plain row with a hairline divider (the way a real table or a phone's
    // Settings list packs rows) is what actually lets many players fit at
    // once instead of just one or two.
    weeklyGrid.classList.toggle("minimal-list", minimalView);
    const gamesData = await fetchGames();
    const gamesForWeek = gamesData.find((g) => g.week === weekNumber)?.games || [];
    const selectedPlayer = playerSelect.value;
    const selectedTeam = teamSelect.value;

    const playersToShow = selectedPlayer === "all" ? allPlayers.slice() : allPlayers.filter((p) => p.uid === selectedPlayer);

    let playerCards = playersToShow.map((player) => {
      const weekData = scoresData[player.uid].weeks?.[`week${weekNumber}`] || { teams: {}, total: 0 };
      return { ...player, weekData, correctedTotal: weekData.total || 0 };
    });

    // A team filter narrows the grid down to just the players who actually
    // picked that team, rather than showing everyone and highlighting the
    // one row — much faster to scan when a team has a handful of takers
    // out of a large field.
    if (selectedTeam !== "all") {
      playerCards = playerCards.filter((player) => selectedTeam in (player.weekData.teams || {}));
    }

    playerCards.sort((a, b) => (b.correctedTotal !== a.correctedTotal ? b.correctedTotal - a.correctedTotal : a.name.localeCompare(b.name)));

    playerCards.forEach((player) => {
      const weekData = player.weekData;
      const isMe = loggedInUser && player.name === loggedInUser;

      const hasPicks = weekData && Object.keys(weekData.teams).length > 0;
      let orderedTeams = [];
      if (hasPicks) {
        const bonusTeam = Object.entries(weekData.teams).find(([, info]) => info.bonus);
        const otherTeams = Object.entries(weekData.teams).filter(([, info]) => !info.bonus);
        otherTeams.sort(([a], [b]) => {
          const idxA = gamesForWeek.findIndex((g) => g.homeTeam === a || g.awayTeam === a);
          const idxB = gamesForWeek.findIndex((g) => g.homeTeam === b || g.awayTeam === b);
          return idxA - idxB;
        });
        orderedTeams = bonusTeam ? [bonusTeam, ...otherTeams] : otherTeams;
      }

      if (minimalView) {
        // One dense row per player — name across the top, 5 tiny pick
        // chips + total below — instead of a card with its own header/
        // padding/shadow. No profile photo: several players are still on
        // the default placeholder, which read as broken/inconsistent next
        // to real team logos at the same circle size.
        const row = document.createElement("div");
        row.className = "pick-list-row";
        if (isMe) row.classList.add("is-me");

        const nameEl = document.createElement("div");
        nameEl.className = "player-name-mini";
        nameEl.textContent = player.name;
        row.appendChild(nameEl);

        // Each pick is its own grid cell (5 fixed-width columns defined on
        // .pick-list-row) rather than living in a flex-wrap strip — a
        // player's 3rd pick otherwise sits wherever their 1st and 2nd
        // picks' rendered widths happened to push it, so the 5 chips never
        // lined up between rows. Fixed columns make every row's chips
        // align into a real table, whatever each player's own team names
        // or pick count happen to be.
        if (!hasPicks) {
          const msg = document.createElement("span");
          msg.className = "no-picks-message-inline";
          msg.style.gridColumn = "1 / 6";
          msg.textContent = "No picks";
          row.appendChild(msg);
        } else {
          // Explicit column placement (rather than relying on grid
          // auto-placement) so a player who hasn't finished submitting yet
          // — fewer than 5 picks — still gets their existing picks pinned
          // to their real column instead of bunching left and knocking the
          // total out of its column too.
          orderedTeams.forEach(([team, info], pickIndex) => {
            const game = gamesForWeek.find((g) => g.homeTeam === team || g.awayTeam === team);
            const isDecided = game && game.status === "Completed";
            let resultClass = "";
            if (isDecided) resultClass = info.points > 0 ? "win" : "loss";

            const chip = document.createElement("div");
            chip.className = `pick-chip-mini ${resultClass}`;
            chip.style.gridColumn = String(1 + pickIndex);
            if (info.bonus) chip.classList.add("bonus");
            if (selectedTeam !== "all" && team === selectedTeam) chip.classList.add("highlighted");

            const winPct = !isDecided && game ? (team === game.homeTeam ? game.homeWinPct : game.awayWinPct) : null;

            let title = team;
            if (isDecided) title += ` (${info.points} pts)`;
            else if (winPct != null) title += ` (${winPct}% win)`;
            chip.title = title;

            const logo = document.createElement("img");
            logo.src = getLogoPath(team);
            logo.alt = team;
            logo.className = "team-logo";
            chip.appendChild(logo);

            // Points are always 0 before a game is decided (there's nothing
            // to score yet) — swap in the win% instead whenever odds are
            // toggled on, since that's the actually-meaningful number at
            // that point, right beside the logo rather than needing a
            // separate toggled-off view. Falls back to the plain "0"
            // placeholder if odds are off or a book hasn't posted a line yet.
            const valueSpan = document.createElement("span");
            if (isDecided) {
              valueSpan.className = "chip-value";
              valueSpan.textContent = info.points;
            } else if (showOdds && winPct != null) {
              valueSpan.className = "chip-value chip-odds";
              valueSpan.textContent = `${winPct}%`;
            } else {
              valueSpan.className = "chip-value chip-pending";
              valueSpan.textContent = "0";
            }
            chip.appendChild(valueSpan);

            row.appendChild(chip);
          });
        }

        const totalSpan = document.createElement("span");
        totalSpan.className = "row-total-mini";
        totalSpan.style.gridColumn = "6";
        totalSpan.textContent = player.correctedTotal;
        row.appendChild(totalSpan);

        weeklyGrid.appendChild(row);
        return;
      }

      const card = document.createElement("div");
      card.className = "pick-box";
      if (isMe) card.classList.add("is-me");

      const title = document.createElement("div");
      title.className = "player-header";
      title.innerHTML = `
        <img src="${scoresData[player.uid].photoURL || DEFAULT_AVATAR}" alt="${player.name}" class="profile-pic">
        <h3>${player.name}</h3>
      `;
      card.appendChild(title);

      const ul = document.createElement("ul");
      ul.className = "pick-list";

      if (!hasPicks) {
        const li = document.createElement("li");
        li.textContent = "No picks submitted";
        ul.appendChild(li);
      } else {
        for (const [team, info] of orderedTeams) {
          const li = document.createElement("li");
          li.className = "pick-row";
          if (info.bonus) li.classList.add("bonus");
          if (selectedTeam !== "all" && team === selectedTeam) {
            li.classList.add("highlighted");
          }

          const game = gamesForWeek.find((g) => g.homeTeam === team || g.awayTeam === team);
          let resultClass = "";
          if (game && game.status === "Completed") resultClass = info.points > 0 ? "win" : "loss";

          const logo = document.createElement("img");
          logo.src = getLogoPath(team);
          logo.alt = team;
          logo.className = "team-logo";
          li.appendChild(logo);

          const nameSpan = document.createElement("span");
          nameSpan.className = `team-name ${resultClass}`;
          nameSpan.textContent = team;
          li.appendChild(nameSpan);

          // Odds only mean anything before the outcome is known — a
          // completed game's real result already speaks for itself, so
          // skip the suffix there rather than show a stale pre-game number.
          // Kept as its own flex item (not nested in the truncating
          // team-name span) so it stays fully readable even when a long
          // team name has to ellipsize in a narrow column.
          if (showOdds && game && game.status !== "Completed") {
            const winPct = team === game.homeTeam ? game.homeWinPct : game.awayWinPct;
            if (winPct != null) {
              const oddsSpan = document.createElement("span");
              oddsSpan.className = "team-odds";
              oddsSpan.textContent = `(${winPct}% win)`;
              li.appendChild(oddsSpan);
            }
          }

          const ptsSpan = document.createElement("span");
          ptsSpan.className = "team-points";
          ptsSpan.textContent = info.points;
          li.appendChild(ptsSpan);

          ul.appendChild(li);
        }
      }
      card.appendChild(ul);

      const totalRow = document.createElement("div");
      totalRow.className = "pick-box-total";
      totalRow.textContent = `Total: ${player.correctedTotal}`;
      card.appendChild(totalRow);

      weeklyGrid.appendChild(card);
    });

    if (playerCards.length === 0) {
      weeklyGrid.innerHTML = `<p class="no-picks-message">No one picked ${selectedTeam} this week.</p>`;
    }

    counterEl.style.display = selectedTeam !== "all" ? "inline" : "none";
    if (selectedTeam !== "all") counterEl.textContent = `${playerCards.length}/${allPlayers.length} player(s)`;

    if (!matchupsContainer.classList.contains("hidden")) renderMatchups(gamesForWeek);
    updateMatchupsColumnCount();
  }

  // weeklyGrid's columns are auto-fill/minmax(280px, 1fr), so its actual
  // column count depends on the viewport — not something a fixed media-query
  // breakpoint can know. Once there's room for 3+ pick columns, the matchups
  // panel widens and lays its own day-boxes out two-wide instead of one long
  // scrolling list (see .matchups-two-col in dashboard.css).
  //
  // Deliberately NOT measured by reading weeklyGrid's live column count:
  // widening the matchups panel eats into weeklyGrid's own width, which
  // could drop its column count back below 3 and immediately reverse the
  // decision that caused the widening — an infinite flip-flop. Instead this
  // computes how many columns weeklyGrid WOULD have at the panel's normal
  // (single-column) width, a value that doesn't change once two-col mode
  // is applied, so the decision is stable. The 280/14/20/300 constants
  // mirror .weekly-picks-grid / .picks-layout / .matchups-container in
  // dashboard.css — keep them in sync if those change.
  const GRID_TRACK_MIN = 280;
  const GRID_GAP = 14;
  const PICKS_LAYOUT_GAP = 20;
  const MATCHUPS_BASE_WIDTH = 300;
  function updateMatchupsColumnCount() {
    if (matchupsContainer.classList.contains("hidden")) return;
    const layoutWidth = document.querySelector(".picks-layout").clientWidth;
    const availableForGrid = layoutWidth - MATCHUPS_BASE_WIDTH - PICKS_LAYOUT_GAP;
    const columns = Math.max(1, Math.floor((availableForGrid + GRID_GAP) / (GRID_TRACK_MIN + GRID_GAP)));
    matchupsContainer.classList.toggle("matchups-two-col", columns >= 3);
  }
  window.addEventListener("resize", () => requestAnimationFrame(updateMatchupsColumnCount));
  window.addEventListener("resize", () => requestAnimationFrame(fitPodiumNames));

  // =========================
  // Matchups
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
        away.className = "team-label";
        const awayLogo = document.createElement("img");
        awayLogo.src = getLogoPath(game.awayTeam);
        awayLogo.className = "matchup-logo";
        away.appendChild(awayLogo);
        const awayName = document.createElement("span");
        awayName.className = "team-label-text";
        awayName.textContent = game.awayTeam;
        awayName.title = game.awayTeam;
        away.appendChild(awayName);

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
        const homeName = document.createElement("span");
        homeName.className = "team-label-text";
        homeName.textContent = game.homeTeam;
        homeName.title = game.homeTeam;
        home.appendChild(homeName);

        if (game.status === "Completed") {
          if (game.homeScore > game.awayScore) {
            home.classList.add("winner"); homeScore.classList.add("winner");
            away.classList.add("loser"); awayScore.classList.add("loser");
          } else {
            away.classList.add("winner"); awayScore.classList.add("winner");
            home.classList.add("loser"); homeScore.classList.add("loser");
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
    const text = lastUpdatedData.last_updated ? formatLocalTime(lastUpdatedData.last_updated) : "[Unknown]";
    lastUpdatedTimeEls.forEach((el) => { el.textContent = text; });
  } catch {
    lastUpdatedTimeEls.forEach((el) => { el.textContent = "[Error]"; });
  }

  toggleMinimalBtn.addEventListener("change", () => {
    minimalView = toggleMinimalBtn.checked;
    localStorage.setItem("pick5_minimalView", minimalView);
    if (currentTab === "picks") loadWeeklyPicks(currentWeek);
  });

  toggleOddsBtn.addEventListener("change", () => {
    showOdds = toggleOddsBtn.checked;
    localStorage.setItem("pick5_showOdds", showOdds);
    if (currentTab === "picks") loadWeeklyPicks(currentWeek);
  });

  toggleScoresBtn.addEventListener("change", async () => {
    const isShown = toggleScoresBtn.checked;
    localStorage.setItem("pick5_showMatchups", isShown);
    matchupsContainer.classList.toggle("hidden", !isShown);
    if (isShown) {
      const gamesData = await fetchGames();
      const gamesForWeek = gamesData.find((g) => g.week === currentWeek)?.games || [];
      renderMatchups(gamesForWeek);
      updateMatchupsColumnCount();
    }
  });

  playerSelect.addEventListener("change", () => { if (currentTab === "picks") loadWeeklyPicks(currentWeek); });
  teamSelect.addEventListener("change", () => { if (currentTab === "picks") loadWeeklyPicks(currentWeek); });
});
