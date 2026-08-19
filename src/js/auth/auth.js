// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Firebase init
import { app } from "./firebase_init.js";
import { authedFetch, getSeasonConfig } from "../util/api.js";
const auth = getAuth(app);

// =======================
// Auth Listener
// =======================
onAuthStateChanged(auth, async (user) => {
  const userDisplay = document.getElementById("user-display");
  const logoutBtn = document.getElementById("logout-btn");

  if (user) {
    console.log("🔑 Logged in:", user.uid);

    // Sourced from the server, not the client-cached Firebase Auth object —
    // right after signup, updateProfile()'s displayName change isn't
    // guaranteed to have persisted across a full-page redirect yet.
    let name = user.displayName || user.email || "User";
    try {
      const profile = await authedFetch("/api/profile/me");
      if (profile.displayName) name = profile.displayName;
    } catch (err) {
      console.error("❌ Error loading profile:", err);
    }
    if (userDisplay) userDisplay.textContent = name;
    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.onclick = () => logoutUser();
    }
  } else {
    console.log("👤 Not logged in");
    if (userDisplay) userDisplay.textContent = "Guest";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
});

// =======================
// Signup Logic
// =======================
const signupForm = document.getElementById("signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const season = await getSeasonConfig();
    if (season.locked) {
      alert("🚫 Signup is closed for this season.");
      window.location.href = "dashboard.html";
      return;
    }

    const displayName = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (password !== confirmPassword) {
      alert("Passwords do not match. Please try again.");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName });
      await authedFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });

      console.log("✅ User signed up:", user.uid);
      alert("Account created successfully!");
      window.location.href = "leagues.html";
    } catch (error) {
      console.error("Signup error:", error.message);

      if (error.code === "auth/email-already-in-use") {
        alert("⚠️ This email is already registered. Redirecting to login...");
        window.location.href = "login.html";
      } else {
        alert("Error: " + error.message);
      }
    }
  });
}

// =======================
// Login Logic
// =======================
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log("✅ Logged in:", userCredential.user);
      window.location.href = "leagues.html";
    } catch (error) {
      console.error("Login error:", error.message);
      alert("Error: " + error.message);
    }
  });
}

// =======================
// Logout
// =======================
export async function logoutUser() {
  try {
    await signOut(auth);
    window.location.href = "index.html";
  } catch (error) {
    alert(error.message);
  }
}

// =======================
// Adjust Login Footer Link
// =======================
const authLink = document.getElementById("auth-link");
if (authLink) {
  getSeasonConfig().then((season) => {
    if (season.locked) {
      authLink.textContent = "Back to home";
      authLink.href = "index.html";
    } else {
      authLink.textContent = "Don’t have an account? Sign Up";
      authLink.href = "signup.html";
    }
  });
}
