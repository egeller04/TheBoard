import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBO7kG7zwec_-nDdlKkUT_SKzckDyig3Vc",
  authDomain: "theboard-6f283.firebaseapp.com",
  projectId: "theboard-6f283",
  storageBucket: "theboard-6f283.firebasestorage.app",
  messagingSenderId: "438090881327",
  appId: "1:438090881327:web:25cddde99aaffd3c7e69da"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const auth = getAuth(app);