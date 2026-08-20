// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Firebase init
import { app } from "./firebase_init.js";
import { authedFetch, getSeasonConfig } from "../util/api.js";
import { showToast } from "../util/toast.js";
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
      showToast("Signup is closed for this season.", "error");
      setTimeout(() => (window.location.href = "dashboard.html"), 1200);
      return;
    }

    const displayName = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (password !== confirmPassword) {
      showToast("Passwords do not match. Please try again.", "error");
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
      showToast("Account created successfully!", "success");
      setTimeout(() => (window.location.href = "leagues.html"), 800);
    } catch (error) {
      console.error("Signup error:", error.message);

      if (error.code === "auth/email-already-in-use") {
        showToast("This email is already registered. Redirecting to login...", "error");
        setTimeout(() => (window.location.href = "login.html"), 1200);
      } else {
        showToast("Error: " + error.message, "error");
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
      showToast("Error: " + error.message, "error");
    }
  });
}

// =======================
// Forgot Password
// =======================
const forgotPasswordLink = document.getElementById("forgot-password-link");
const forgotPasswordModal = document.getElementById("forgot-password-modal");
if (forgotPasswordLink && forgotPasswordModal) {
  const formView = document.getElementById("forgot-password-form-view");
  const successView = document.getElementById("forgot-password-success-view");
  const form = document.getElementById("forgot-password-form");
  const emailInput = document.getElementById("forgot-password-email");
  const errorEl = document.getElementById("forgot-password-error");
  const sentEmailEl = document.getElementById("forgot-password-sent-email");
  const closeBtn = document.getElementById("close-forgot-password");
  const doneBtn = document.getElementById("forgot-password-done-btn");

  function closeForgotPasswordModal() {
    forgotPasswordModal.classList.add("hidden");
  }

  function openForgotPasswordModal() {
    formView.classList.remove("hidden");
    successView.classList.add("hidden");
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
    const loginEmail = document.getElementById("login-email");
    emailInput.value = loginEmail?.value.trim() || "";
    forgotPasswordModal.classList.remove("hidden");
  }

  forgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();
    openForgotPasswordModal();
  });

  closeBtn?.addEventListener("click", closeForgotPasswordModal);
  doneBtn?.addEventListener("click", closeForgotPasswordModal);
  forgotPasswordModal.addEventListener("click", (e) => {
    if (e.target === forgotPasswordModal) closeForgotPasswordModal();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    errorEl.classList.add("hidden");

    try {
      await sendPasswordResetEmail(auth, email);
      sentEmailEl.textContent = email;
      formView.classList.add("hidden");
      successView.classList.remove("hidden");
    } catch (error) {
      console.error("Password reset error:", error.message);
      errorEl.textContent = "Error: " + error.message;
      errorEl.classList.remove("hidden");
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
    showToast(error.message, "error");
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
