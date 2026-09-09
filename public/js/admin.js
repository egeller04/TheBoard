import { auth, db } from "./firebase-init.js";
import { signInWithEmailAndPassword, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc, deleteDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const storage = getStorage();

document.getElementById("loginSubmit").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const status = document.getElementById("loginStatus");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    status.textContent = err.message || "Login failed.";
  }
});

onAuthStateChanged(auth, (user) => {
  document.getElementById("loginScreen").style.display = user ? "none" : "block";
  document.getElementById("adminBody").style.display = user ? "block" : "none";
  if (user) {
    loadWeekConfig();
    loadPunishments();
  }
});

// ---- Week config ----
async function loadWeekConfig() {
  const snap = await getDoc(doc(db, "config", "current"));
  const c = snap.exists() ? snap.data() : {};
  document.getElementById("weekNumber").value = c.week || "";
  document.getElementById("teamAId").value = c.teamAId || "";
  document.getElementById("teamBId").value = c.teamBId || "";
  document.getElementById("weeklyPassword").value = c.weeklyPassword || "";
  if (c.revealAt?.toDate) {
    const d = c.revealAt.toDate();
    document.getElementById("revealAt").value = d.toISOString().slice(0, 16);
  }
  document.getElementById("wheelStatusText").textContent = c.spinLocked
    ? `Spun — landed on: "${c.spinResult}"${c.videoStoragePath ? " (video uploaded)" : " (no video yet)"}`
    : "Not spun yet this week.";
}

document.getElementById("saveWeekBtn").addEventListener("click", async () => {
  const status = document.getElementById("weekStatus");
  try {
    const revealVal = document.getElementById("revealAt").value;
    await setDoc(doc(db, "config", "current"), {
      week: Number(document.getElementById("weekNumber").value),
      teamAId: Number(document.getElementById("teamAId").value),
      teamBId: Number(document.getElementById("teamBId").value),
      weeklyPassword: document.getElementById("weeklyPassword").value,
      revealAt: revealVal ? Timestamp.fromDate(new Date(revealVal)) : null
    }, { merge: true });
    status.textContent = "Saved.";
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});

document.getElementById("resetWheelBtn").addEventListener("click", async () => {
  const status = document.getElementById("resetStatus");
  try {
    await updateDoc(doc(db, "config", "current"), {
      spinLocked: false,
      spinResult: null,
      spinResultIndex: null,
      videoStoragePath: null
    });
    status.textContent = "Wheel reset.";
    loadWeekConfig();
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});

// ---- Punishments ----
async function loadPunishments() {
  const container = document.getElementById("punishmentRows");
  container.innerHTML = "";
  const snap = await getDocs(collection(db, "punishments"));
  snap.forEach((d) => container.appendChild(punishmentRow(d.id, d.data().text)));
}

function punishmentRow(id, text) {
  const row = document.createElement("div");
  row.className = "punishment-row";
  row.innerHTML = `<input type="text" value="${text.replace(/"/g, "&quot;")}" data-id="${id}"><button>Remove</button>`;
  row.querySelector("input").addEventListener("change", async (e) => {
    await updateDoc(doc(db, "punishments", id), { text: e.target.value });
  });
  row.querySelector("button").addEventListener("click", async () => {
    await deleteDoc(doc(db, "punishments", id));
    row.remove();
  });
  return row;
}

document.getElementById("addPunishmentBtn").addEventListener("click", async () => {
  const status = document.getElementById("punishmentStatus");
  const container = document.getElementById("punishmentRows");
  try {
    const docRef = await addDoc(collection(db, "punishments"), { text: "New punishment" });
    container.appendChild(punishmentRow(docRef.id, "New punishment"));
    status.textContent = "Added — edit the text above.";
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});

// ---- Archive to history ----
document.getElementById("archiveBtn").addEventListener("click", async () => {
  const status = document.getElementById("archiveStatus");
  try {
    const configSnap = await getDoc(doc(db, "config", "current"));
    const config = configSnap.data() || {};

    let videoUrl = null;
    if (config.videoStoragePath) {
      try {
        videoUrl = await getDownloadURL(ref(storage, config.videoStoragePath));
      } catch (e) {
        console.warn("No video found at stored path yet.");
      }
    }

    await addDoc(collection(db, "history"), {
      week: config.week || Number(document.getElementById("weekNumber").value),
      winnerName: document.getElementById("archWinnerName").value,
      winnerScore: Number(document.getElementById("archWinnerScore").value),
      loserName: document.getElementById("archLoserName").value,
      loserScore: Number(document.getElementById("archLoserScore").value),
      closingSpread: document.getElementById("archSpread").value,
      overUnder: document.getElementById("archOU").value,
      punishmentText: config.spinResult || null,
      videoUrl
    });

    await updateDoc(doc(db, "config", "current"), {
      spinLocked: false,
      spinResult: null,
      spinResultIndex: null,
      videoStoragePath: null
    });

    status.textContent = "Archived to Past Games. Set up next week's matchup above.";
    loadWeekConfig();
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});