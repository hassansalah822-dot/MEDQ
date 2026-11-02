// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwIVdzdqgRsLdGz7GzZMwT82vweSq7w9U",
  authDomain: "medq-question-bank.firebaseapp.com",
  projectId: "medq-question-bank",
  storageBucket: "medq-question-bank.firebasestorage.app",
  messagingSenderId: "47529075738",
  appId: "1:47529075738:web:1372d4fe51886d5dc81da3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Keep user logged in locally
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Auth persistence error:", error);
});

console.log("MEDQ Firebase connected (Spck Editor Safe Mode)");
