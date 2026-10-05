import { requireLogin } from "./auth-guard.js";
import { db, functions } from "./firebase-init.js";
import { doc, collection, getDocs, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

await requireLogin();

const addBeer = httpsCallable(functions, "addBeer");
const getMatchup = httpsCallable(functions, "getMatchup");
const verifyWeeklyPassword = httpsCallable(functions, "verifyWeeklyPassword");
const spinWheelFn = httpsCallable(functions, "spinWheel");
const getUploadUrlFn = httpsCallable(functions, "getUploadUrl");

let currentConfig = null;
let punishmentList = [];
let countdownTimer;
let spinPassword;
let matchupLoading = false;

// Each tap adds exactly one beer; the server transaction handles concurrent taps.
function watchBeerCounter() {
  onSnapshot(doc(db, "stats", "beerCounter"), (snap) => {
    document.getElementById("beerCount").textContent = Math.max(0, Math.round(Number(snap.data()?.count) || 0));
  }, () => { document.getElementById("beerStatus").textContent = "Couldn't load the beer count."; });
}

document.getElementById("addBeerBtn").addEventListener("click", async () => {
  const status = document.getElementById("beerStatus");
  status.textContent = "";
  try { await addBeer(); }
  catch { status.textContent = "Beer wasn't added. Tap again to retry."; }
});

// ---- Load live matchup + rosters ----
async function loadMatchup() {
  if (matchupLoading) return;
  matchupLoading = true;
  try {
    const { data } = await getMatchup();
    renderMatchup(data);
    document.getElementById("matchupError").style.display = "none";
  } catch (err) {
    console.error("getMatchup failed:", err);
    document.getElementById("matchupError").textContent =
      "Couldn't load live matchup data. " + (err.message || "");
    document.getElementById("matchupError").style.display = "block";
  } finally { matchupLoading = false; }
}

function renderMatchup(data) {
  document.getElementById("weekTag").textContent = `WEEK ${data.week}`;

  const a = data.teamA, b = data.teamB;
  if (a) {
    document.getElementById("teamAName").textContent = a.name;
    document.getElementById("teamARecord").textContent =
      `${a.record?.wins ?? 0}–${a.record?.losses ?? 0}`;
    document.getElementById("teamAScore").textContent = a.score?.toFixed(1) ?? "0.0";
    document.getElementById("teamAPlayoff").textContent = `${a.roughPlayoffPct}%`;
  }
  if (b) {
    document.getElementById("teamBName").textContent = b.name;
    document.getElementById("teamBRecord").textContent =
      `${b.record?.wins ?? 0}–${b.record?.losses ?? 0}`;
    document.getElementById("teamBScore").textContent = b.score?.toFixed(1) ?? "0.0";
    document.getElementById("teamBPlayoff").textContent = `${b.roughPlayoffPct}%`;
  }

  document.getElementById("teamAScore").classList.remove("leading");
  document.getElementById("teamBScore").classList.remove("leading");
  const leadingKey = (a?.score ?? 0) >= (b?.score ?? 0) ? "teamAScore" : "teamBScore";
  document.getElementById(leadingKey).classList.add("leading");

  if (a) {
    document.getElementById("pfNameA").textContent = a.name;
    document.getElementById("pfBarA").style.width = `${a.roughPlayoffPct}%`;
  }
  if (b) {
    document.getElementById("pfNameB").textContent = b.name;
    document.getElementById("pfBarB").style.width = `${b.roughPlayoffPct}%`;
  }


  renderRoster("rosterA", data.rosterA);
  renderRoster("rosterB", data.rosterB);
}

function renderRoster(tableId, players) {
  const tbody = document.getElementById(tableId);
  tbody.innerHTML = "";

  const positionOrder = {
    "QB": 1,
    "RB": 2,
    "WR": 3,
    "TE": 4,
    "FLEX": 5,
    "K": 6,
    "D/ST": 7
  };

  const sortedPlayers = [...(players || [])].sort(
    (a, b) => positionOrder[a.position] - positionOrder[b.position]
  );

  sortedPlayers.forEach((p) => {
    const row = document.createElement("tr");

    const values = [p.name, p.position || "—", p.left || "—", Number(p.points || 0).toFixed(1)];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 2) cell.className = "mins";
      if (index === 3) cell.className = "pts";
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
}


// ---- Config (week number, reveal time, wheel lock state) ----
function watchConfig() {
  const ref = doc(db, "config", "current");
  onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    currentConfig = snap.data();
    updateCountdown();
    if (currentConfig.spinLocked) {
      showLockedResult(currentConfig.spinResult);
    } else {
      document.getElementById("spinResult").textContent = "";
      document.getElementById("uploadSection").style.display = "none";
      document.getElementById("spinBtn").disabled = false;
      document.getElementById("loginBtn").textContent = "UNLOCK WHEEL";
    }
  });
}

function updateCountdown() {
  clearInterval(countdownTimer);
  if (!currentConfig?.revealAt) {
    ["cd-d", "cd-h", "cd-m", "cd-s"].forEach(id => { document.getElementById(id).textContent = "--"; });
    return;
  }
  const target = currentConfig.revealAt.toDate
    ? currentConfig.revealAt.toDate()
    : new Date(currentConfig.revealAt);

  function tick() {
    const diff = Math.max(0, target - new Date());
    document.getElementById("cd-d").textContent = String(Math.floor(diff / 864e5)).padStart(2, "0");
    document.getElementById("cd-h").textContent = String(Math.floor(diff / 36e5) % 24).padStart(2, "0");
    document.getElementById("cd-m").textContent = String(Math.floor(diff / 6e4) % 60).padStart(2, "0");
    document.getElementById("cd-s").textContent = String(Math.floor(diff / 1e3) % 60).padStart(2, "0");
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---- Wheel ----
async function loadPunishmentLabels() {
  const snap = await getDocs(collection(db, "punishments"));
  punishmentList = snap.docs.map((d) => d.data().text);
  buildWheel(punishmentList);
}
 
function buildWheel(labels) {
  const svgNS = "http://www.w3.org/2000/svg";
  const wheel = document.getElementById("wheel");
  wheel.innerHTML = "";
  const cx = 150, cy = 150, r = 145, n = Math.max(labels.length, 1);
  if (!labels.length) {
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", cx); circle.setAttribute("cy", cy); circle.setAttribute("r", r);
    circle.setAttribute("fill", "#1D5CD1"); wheel.appendChild(circle);
    return;
  }
  const colors = ["#1D5CD1", "#E8A93B"];
 
  // Fewer wedges = more angular room per wedge = can fit bigger text/wider lines.
  const fontSize = n <= 5 ? 10 : n <= 8 ? 8.5 : n <= 12 ? 7 : 6;
  const maxCharsPerLine = n <= 5 ? 18 : n <= 8 ? 14 : n <= 12 ? 11 : 9;
  const maxLines = n <= 8 ? 4 : 5;
 
  labels.forEach((label, i) => {
    const color = colors[i % 2];
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", n === 1
      ? `M${cx},${cy-r} A${r},${r} 0 1 1 ${cx},${cy+r} A${r},${r} 0 1 1 ${cx},${cy-r} Z`
      : `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${n === 2 ? 1 : 0} 1 ${x1},${y1} Z`);
    path.setAttribute("fill", color);
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "2");
    wheel.appendChild(path);
 
    const lines = wrapLabel(label, maxCharsPerLine, maxLines);
    const mid = (a0 + a1) / 2;
    const lx = cx + r * 0.64 * Math.cos(mid), ly = cy + r * 0.64 * Math.sin(mid);
    const rotateDeg = n === 1 ? 0 : (mid * 180) / Math.PI + 90;
 
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", lx);
    text.setAttribute("y", ly);
    text.setAttribute("fill", color === "#E8A93B" ? "#0B1F3A" : "#fff");
    text.setAttribute("font-size", fontSize);
    text.setAttribute("font-family", "Space Mono, monospace");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("transform", `rotate(${rotateDeg}, ${lx}, ${ly})`);
 
    const lineHeight = fontSize + 1.5;
    const startDy = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, li) => {
      const tspan = document.createElementNS(svgNS, "tspan");
      tspan.setAttribute("x", lx);
      tspan.setAttribute("dy", li === 0 ? startDy : lineHeight);
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    wheel.appendChild(text);
  });
}
 
// Greedily wraps a label onto multiple lines that fit within the wedge,
// truncating with an ellipsis only in the rare case it still overflows
// the max number of lines for this wheel size.
function wrapLabel(label, maxChars, maxLines) {
  const words = String(label || "").trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else { current = candidate; }
  }
  if (current) lines.push(current);
  const truncated = lines.length > maxLines;
  const result = lines.slice(0, maxLines).map(line => line.length > maxChars ? line.slice(0, maxChars - 1) + "…" : line);
  if (truncated) result[maxLines - 1] = result[maxLines - 1].slice(0, maxChars - 1) + "…";
  return result;
}

function spinWheelToIndex(index, total) {
  const segAngle = 360 / total;
  const targetAngle = 360 * 6 - index * segAngle - segAngle / 2;
  const wheel = document.getElementById("wheel");
  wheel.style.transform = `rotate(${targetAngle}deg)`;
}

document.getElementById("unlockBtn").addEventListener("click", async () => {
  const password = document.getElementById("pwInput").value;
  const errEl = document.getElementById("pwError");
  errEl.textContent = "";
  try {
    await verifyWeeklyPassword({ password });
    document.getElementById("unlockedArea").style.display = currentConfig?.spinLocked ? "none" : "block";
    if (currentConfig?.spinLocked) document.getElementById("lockOverlay").classList.remove("show");
    document.getElementById("pwGate").style.display = "none";
    spinPassword = password;
  } catch (err) {
    errEl.textContent = err.message || "Incorrect password.";
  }
});

document.getElementById("spinBtn").addEventListener("click", async () => {
  const btn = document.getElementById("spinBtn");
  btn.disabled = true;
  try {
    const { data } = await spinWheelFn({ password: spinPassword });
    spinWheelToIndex(data.index, punishmentList.length);
    setTimeout(() => {
      document.getElementById("lockOverlay").classList.remove("show");
      showLockedResult(data.result);
    }, 4600);
  } catch (err) {
    document.getElementById("pwError").textContent = err.message || "Something went wrong.";
    btn.disabled = false;
  }
});

function showLockedResult(resultText) {
  document.getElementById("spinResult").textContent = "LANDED ON: " + (resultText || "").toUpperCase();
  document.getElementById("uploadSection").style.display = "block";
  document.getElementById("loginBtn").textContent = "UNLOCK VIDEO UPLOAD";
}

document.getElementById("uploadBtn")?.addEventListener("click", async () => {
  const fileInput = document.getElementById("videoFile");
  const file = fileInput.files[0];
  const status = document.getElementById("uploadStatus");
  if (!file) { status.textContent = "Choose a video file first."; return; }

  status.textContent = "Uploading…";
  try {
    const { data } = await getUploadUrlFn({
      password: spinPassword,
      fileName: file.name,
      contentType: file.type || "video/mp4"
    });
    const upload = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "video/mp4" }, body: file });
    if (!upload.ok) throw new Error("Storage rejected the upload. Please try again.");
    status.textContent = "Uploaded! You're off the hook — for this week.";
  } catch (err) {
    status.textContent = "Upload failed: " + (err.message || "");
  }
});

document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("pwGate").style.display = "block";
  document.getElementById("unlockedArea").style.display = "none";
  document.getElementById("pwError").textContent = "";
  document.getElementById("lockOverlay").classList.add("show");
  document.getElementById("pwInput").focus();
});
document.querySelectorAll(".lock-close").forEach((el) =>
  el.addEventListener("click", () => document.getElementById("lockOverlay").classList.remove("show"))
);

loadMatchup();
watchConfig();
loadPunishmentLabels().catch(() => { document.getElementById("spinResult").textContent = "Could not load the wheel. Refresh to retry."; });
setInterval(loadMatchup, 30000);
watchBeerCounter();
