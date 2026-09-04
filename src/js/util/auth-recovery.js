// Recovery for a known Safari/WebKit bug (still open as of this writing:
// https://bugs.webkit.org/show_bug.cgi?id=226547) where indexedDB.open()
// sometimes hangs forever — never resolves, never rejects. Firebase Auth's
// session lookup depends on IndexedDB, so when this hits, onAuthStateChanged
// simply never fires. A plain reload does NOT fix it: the new page just
// calls indexedDB.open() again against the same wedged per-origin storage
// connection and hangs the same way (confirmed by multiple reports against
// firebase-js-sdk). The only reliable fix is fully closing and reopening the
// browser/app, which tears down that connection — something no web page can
// trigger on its own.
//
// What we CAN do: clear Firebase's local IndexedDB databases (this often
// un-wedges a merely-corrupted store, as opposed to the deeper same-process
// lock) and reload once automatically. If that reload also stalls, we stop
// retrying — an automatic loop would just spin forever against the same OS
// bug — and tell the caller to show an honest manual message instead.

const RECOVERY_DB_NAMES = ["firebaseLocalStorageDb", "firebase-heartbeat-storage"];
const RECOVERY_FLAG_KEY = "pick5_auth_recovery_attempted";

/**
 * Call this once the auth check has stalled past its timeout.
 * Returns true if it kicked off an automatic recovery reload (the caller
 * should do nothing else and let the reload happen), or false if recovery
 * was already tried this session and the caller should show a manual
 * fallback message instead.
 */
export function attemptAuthStallRecovery() {
  if (sessionStorage.getItem(RECOVERY_FLAG_KEY)) return false;
  sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");

  RECOVERY_DB_NAMES.forEach((name) => {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      // best-effort — if this itself hangs or errors, the reload below is
      // still worth attempting on its own.
    }
  });

  // Give deleteDatabase a moment to fire (or not) before navigating away;
  // we don't await its result since it can hang for the same reason open()
  // does.
  setTimeout(() => window.location.reload(), 150);
  return true;
}

/** Call once auth successfully resolves, so a future genuine stall gets a fresh automatic retry instead of going straight to the manual message. */
export function clearAuthStallRecoveryFlag() {
  sessionStorage.removeItem(RECOVERY_FLAG_KEY);
}

/** True if we already tried the automatic recovery reload this browser session and it didn't help — i.e. the caller is looking at a stall for the second time in a row. */
export function didAuthStallRecoveryAlreadyRun() {
  return !!sessionStorage.getItem(RECOVERY_FLAG_KEY);
}
