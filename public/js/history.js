import { requireLogin } from "./auth-guard.js";
import { db } from "./firebase-init.js";
import { collection, getDocs, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

await requireLogin();

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));

const listEl = document.getElementById("gameList");

async function loadHistory() {
  const q = query(collection(db, "history"), orderBy("week", "desc"));
  const snap = await getDocs(q);
  if (snap.empty) {
    listEl.innerHTML = '<div class="empty-note">No past games yet. Check back after Week 1.</div>';
    return;
  }
  listEl.innerHTML = "";
  snap.forEach((doc) => listEl.appendChild(renderCard(doc.data())));
}

function renderCard(g) {
  const card = document.createElement("div");
  card.className = "game-card";
  const safeVideoUrl = typeof g.videoUrl === "string" && g.videoUrl.startsWith("https://") ? g.videoUrl : null;
  const videoHtml = safeVideoUrl
    ? `<video src="${escapeHtml(safeVideoUrl)}" controls></video>`
    : `<div class="placeholder">No video uploaded yet</div>`;
  card.innerHTML = `
    <div class="card-head"><span>WEEK ${escapeHtml(g.week)}</span><span>FINAL</span></div>
    <div class="card-body">
      <div class="score-row">
        <div class="side winner">
          <div class="tag-line">Winner</div>
          <div class="name">${escapeHtml(g.winnerName)}</div>
          <div class="score">${Number(g.winnerScore).toFixed(1)}</div>
        </div>
        <div class="mid-vs">VS</div>
        <div class="side loser">
          <div class="tag-line">Loser</div>
          <div class="name">${escapeHtml(g.loserName)}</div>
          <div class="score">${Number(g.loserScore).toFixed(1)}</div>
        </div>
      </div>
      <div class="odds-line">CLOSING SPREAD: ${escapeHtml(g.closingSpread || "—")} · O/U ${escapeHtml(g.overUnder || "—")}</div>
      <div class="punishment-block">
        <div class="video-slot">${videoHtml}</div>
        <div class="punishment-text">
          <div class="lbl">Punishment</div>
          <div class="txt">${escapeHtml(g.punishmentText || "—")}</div>
        </div>
      </div>
    </div>`;
  return card;
}

loadHistory().catch(() => { listEl.textContent = "Could not load past games. Refresh to retry."; });
