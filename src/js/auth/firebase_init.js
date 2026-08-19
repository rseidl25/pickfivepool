// firebase_init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyDx00AGnpN53UYrS9ipF6fT7g5EnfhoJm8",
  authDomain: "nflpick5.firebaseapp.com",
  projectId: "nflpick5",
  storageBucket: "nflpick5.firebasestorage.app",
  messagingSenderId: "541402485416",
  appId: "1:541402485416:web:77cee7a9766fbd7db5a89d",
  measurementId: "G-YY2240591L"
};

// Initialize Firebase app ONCE
export const app = initializeApp(firebaseConfig);
