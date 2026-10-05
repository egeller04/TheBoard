import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { auth, db, functions } from "./firebase-init.js";
import { signInWithEmailAndPassword, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc, deleteDoc, Timestamp, onSnapshot, writeBatch, deleteField
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

onAuthStateChanged(auth, async (user) => {
  const isAdmin = user && (await user.getIdTokenResult()).claims.admin === true;
  if (user && !isAdmin) document.getElementById("loginStatus").textContent = "This account does not have admin access.";
  document.getElementById("loginScreen").style.display = isAdmin ? "none" : "block";
  document.getElementById("adminBody").style.display = isAdmin ? "block" : "none";
  stopBeerCounter?.();
  if (isAdmin) {
    loadWeekConfig().catch(error => { document.getElementById("weekStatus").textContent = error.message; });
    loadPunishments().catch(error => { document.getElementById("punishmentStatus").textContent = error.message; });
    watchBeerCounterAdmin();
  }
});

// ---- Whole-beer counter override ----
let stopBeerCounter;
function watchBeerCounterAdmin() {
  stopBeerCounter?.();
  stopBeerCounter = onSnapshot(doc(db, "stats", "beerCounter"), (snap) => {
    const count = Math.max(0, Math.round(Number(snap.data()?.count) || 0));
    document.getElementById("beerCountText").textContent = `Current total: ${count} beers`;
    document.getElementById("beerCountInput").value = count;
  }, error => { document.getElementById("beerCountStatus").textContent = error.message; });
}
document.getElementById("saveBeerCountBtn").addEventListener("click", async () => {
  const status = document.getElementById("beerCountStatus");
  const input = document.getElementById("beerCountInput");
  const count = Number(input.value);
  if (!input.value.trim() || !Number.isSafeInteger(count) || count < 0) {
    status.textContent = "Enter a nonnegative whole number.";
    return;
  }
  try {
    await setDoc(doc(db, "stats", "beerCounter"), { count });
    status.textContent = `Updated to ${count} beers.`;
  } catch (error) { status.textContent = error.message; }
});

// ---- Week config ----
async function loadWeekConfig() {
  const [snap, secret] = await Promise.all([getDoc(doc(db, "config", "current")), getDoc(doc(db, "config", "private"))]);
  const c = snap.exists() ? snap.data() : {};
  document.getElementById("weekNumber").value = c.week || "";
  document.getElementById("teamAId").value = c.teamAId || "";
  document.getElementById("teamBId").value = c.teamBId || "";
  document.getElementById("weeklyPassword").value = secret.data()?.weeklyPassword || "";
  if (c.revealAt?.toDate) {
    const d = c.revealAt.toDate();
    document.getElementById("revealAt").value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  document.getElementById("wheelStatusText").textContent = c.spinLocked
    ? `Spun — landed on: "${c.spinResult}"${c.videoStoragePath ? " (video uploaded)" : " (no video yet)"}`
    : "Not spun yet this week.";
}

document.getElementById("saveWeekBtn").addEventListener("click", async () => {
  const status = document.getElementById("weekStatus");
  try {
    const revealVal = document.getElementById("revealAt").value;
    const week = Number(document.getElementById("weekNumber").value);
    const teamAId = Number(document.getElementById("teamAId").value);
    const teamBId = Number(document.getElementById("teamBId").value);
    if (![week, teamAId, teamBId].every(value => Number.isInteger(value) && value > 0) || teamAId === teamBId) {
      throw new Error("Enter a positive week and two different team IDs.");
    }
    const batch = writeBatch(db);
    batch.set(doc(db, "config", "current"), {
      week, teamAId, teamBId,
      weeklyPassword: deleteField(),
      revealAt: revealVal ? Timestamp.fromDate(new Date(revealVal)) : null
    }, { merge: true });
    batch.set(doc(db, "config", "private"), { weeklyPassword: document.getElementById("weeklyPassword").value }, { merge: true });
    await batch.commit();
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
    await loadWeekConfig();
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
  const input = document.createElement("input");
  input.value = String(text || "");
  input.dataset.id = id;
  const button = document.createElement("button");
  button.textContent = "Remove";
  row.append(input, button);
  row.querySelector("input").addEventListener("change", async (e) => {
    try { await updateDoc(doc(db, "punishments", id), { text: e.target.value }); }
    catch (error) { document.getElementById("punishmentStatus").textContent = error.message; }
  });
  row.querySelector("button").addEventListener("click", async () => {
    try { await deleteDoc(doc(db, "punishments", id)); row.remove(); }
    catch (error) { document.getElementById("punishmentStatus").textContent = error.message; }
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

    const batch = writeBatch(db);
    batch.set(doc(collection(db, "history")), {
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

    batch.update(doc(db, "config", "current"), {
      spinLocked: false,
      spinResult: null,
      spinResultIndex: null,
      videoStoragePath: null
    });

    await batch.commit();
    status.textContent = "Archived to Past Games. Set up next week's matchup above.";
    await loadWeekConfig();
  } catch (err) {
    status.textContent = "Error: " + err.message;
  }
});
document.getElementById("createInviteBtn").addEventListener("click", async () => {
  const status = document.getElementById("inviteStatus");
  const button = document.getElementById("createInviteBtn");
  button.disabled = true;
  try {
    const { data } = await httpsCallable(functions, "createInvitation")({ cooldownSeconds: Number(document.getElementById("inviteCooldown").value) });
    const url = new URL("login.html", location.href);
    url.hash = new URLSearchParams({ invite: data.token }).toString();
    document.getElementById("inviteLink").value = url.href;
    status.textContent = "Send this link to your group. It expires in 7 days, with a " + document.getElementById("inviteCooldown").selectedOptions[0].textContent + " cooldown between successful signups.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
