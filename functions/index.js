const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const ESPN_S2 = defineSecret("ESPN_S2");
const ESPN_SWID = defineSecret("SWID");

// ---- League constants ----
// If the league ID or season ever changes, update here.
const LEAGUE_ID = "460162851";
const SEASON = 2026;

// ESPN's numeric pro-team IDs mapped to standard abbreviations, used to
// cross-reference a fantasy player against the live NFL scoreboard.
const PRO_TEAM_MAP = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU"
};

const STARTER_SLOTS = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  16: "D/ST",
  17: "K",
  23: "FLEX"
};

async function fetchEspnLeague(scoringPeriodId) {
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}` +
    `/segments/0/leagues/${LEAGUE_ID}` +
    `?view=mMatchupScore&view=mTeam&view=mRoster&view=mSettings` +
    `&scoringPeriodId=${scoringPeriodId}`;

  const res = await fetch(url, {
    headers: {
      Cookie: `SWID=${ESPN_SWID.value()}; espn_s2=${ESPN_S2.value()}`,
      Accept: "application/json"
    }
  });
  if (!res.ok) {
    throw new HttpsError(
      "internal",
      `ESPN request failed (${res.status}). Double check the league ID, season, and that the espn_s2/SWID secrets are still valid — ESPN cookies expire periodically.`
    );
  }
  return res.json();
}

async function fetchNflScoreboard() {
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
  );
  if (!res.ok) return { events: [] };
  return res.json();
}

function buildGameClockMap(nflData) {
  const map = {};

  for (const event of nflData.events || []) {
    const comp = event.competitions?.[0];
    const status = comp?.status;

    for (const c of comp?.competitors || []) {
      const state = status?.type?.state;

      map[c.team.abbreviation] = {
        state: state,
        clock: state === "post"
          ? "FINAL"
          : status?.displayClock,
        period: status?.period,
        startTime: event.date
      };
    }
  }

  return map;
}

function formatGameTime(dateString) {
  if (!dateString) return null;

  const date = new Date(dateString);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York"
  });
}

function buildRoster(leagueData, teamId, week, gameClocks) {
  const matchup = (leagueData.schedule || []).find(
    (m) =>
      m.matchupPeriodId === week &&
      (m.home?.teamId === teamId || m.away?.teamId === teamId)
  );

  if (!matchup) return { players: [], total: 0 };

  const side =
    matchup.home?.teamId === teamId ? matchup.home : matchup.away;

  const team = (leagueData.teams || []).find(
    (t) => t.id === teamId
  );

  const STARTER_SLOTS = {
    0: "QB",
    2: "RB",
    4: "WR",
    6: "TE",
    16: "D/ST",
    17: "K",
    23: "FLEX"
  };

  const entries = (team?.roster?.entries || []).filter(
    (entry) => STARTER_SLOTS[entry.lineupSlotId]
  );

  const players = entries.map((entry) => {
    const p = entry.playerPoolEntry.player;

    console.log("POSITION DEBUG:", {
      player: p.fullName,
      lineupSlotId: entry.lineupSlotId,
      type: typeof entry.lineupSlotId,
      mappedPosition: STARTER_SLOTS[entry.lineupSlotId]
    });

    const abbr = PRO_TEAM_MAP[p.proTeamId] || null;
    const game = abbr ? gameClocks[abbr] : null;

    let left = null;

    if (game?.state === "post") {
      left = "FINAL";
    } else if (game?.state === "in") {
      left = `Q${game.period} ${game.clock}`;
    } else if (game?.state === "pre") {
      left = formatGameTime(game.startTime);
    }

    return {
      name: p.fullName,
      position: STARTER_SLOTS[entry.lineupSlotId],
      left,
      points: entry.playerPoolEntry.appliedStatTotal ?? 0
    };
  });

  return {
    players,
    total: players.reduce((sum, p) => sum + (p.points || 0), 0)
  };
}

// Callable from the front end — returns the current Game of the Week's
// live scores, rosters, and status. No auth required (public page).
exports.getMatchup = onCall(
  { secrets: [ESPN_S2, ESPN_SWID] },
  async () => {
    const configSnap = await db.collection("config").doc("current").get();
    if (!configSnap.exists) {
      throw new HttpsError("not-found", "No current matchup is configured yet.");
    }
    const config = configSnap.data();

    const [leagueData, nflData] = await Promise.all([
      fetchEspnLeague(config.week),
      fetchNflScoreboard()
    ]);
    const gameClocks = buildGameClockMap(nflData);

    const teams = leagueData.teams || [];

    console.log("TEAM IMAGE DEBUG:", teams.map(t => ({
      id: t.id,
      name: t.name,
      logo: t.logo,
      managers: t.managers
    })));

    const teamA = teams.find((t) => t.id === config.teamAId);
    const teamB = teams.find((t) => t.id === config.teamBId);

    const rosterA = buildRoster(
      leagueData,
      config.teamAId,
      config.week,
      gameClocks
    );

    const rosterB = buildRoster(
      leagueData,
      config.teamBId,
      config.week,
      gameClocks
    );

    // const projDiff = rosterA.projectedTotal - rosterB.projectedTotal;
    // const overUnder = rosterA.projectedTotal + rosterB.projectedTotal;
    // const spread = {
    //   favorite: Math.abs(projDiff) < 0.05 ? null : (projDiff > 0 ? teamA?.name : teamB?.name),
    //   amount: Math.abs(projDiff)
    // };

    // NOTE: ESPN doesn't expose their internal playoff-simulation
    // percentages through this API. This is a placeholder based on
    // record only, until we build a real projection.
    function roughPlayoffOdds(team) {
      const wins = team?.record?.overall?.wins ?? 0;
      const losses = team?.record?.overall?.losses ?? 0;

      const odds = 50 + (wins - losses) * 10;

      return Math.max(5, Math.min(95, odds));
    }

    return {
      week: config.week,
      // spread,
      // overUnder,
      teamA: teamA && {
        name: teamA.name,
        logo: teamA.logo,
        record: teamA.record?.overall,
        score: rosterA.total,
        roughPlayoffPct: roughPlayoffOdds(teamA)
      },
      teamB: teamB && {
        name: teamB.name,
        logo: teamB.logo,
        record: teamB.record?.overall,
        score: rosterB.total,
        roughPlayoffPct: roughPlayoffOdds(teamB)
      },
      rosterA: rosterA.players,
      rosterB: rosterB.players
    };
  }
);

// Verifies the weekly password without revealing it, and without letting
// the client see whether the wheel is already locked from a prior guess.
exports.verifyWeeklyPassword = onCall(async (request) => {
  const { password } = request.data || {};
  const configSnap = await db.collection("config").doc("current").get();
  if (!configSnap.exists) throw new HttpsError("not-found", "No active week.");
  const config = configSnap.data();

  if (config.spinLocked) {
    throw new HttpsError("failed-precondition", "This week's wheel has already been spun.");
  }
  if (!password || password !== config.weeklyPassword) {
    throw new HttpsError("permission-denied", "Incorrect password.");
  }
  return { ok: true };
});

// Spins the wheel server-side (so the outcome can't be manipulated from
// the browser) and locks the result in Firestore.
exports.spinWheel = onCall(async (request) => {
  const { password } = request.data || {};
  const configRef = db.collection("config").doc("current");

  return db.runTransaction(async (tx) => {
    const configSnap = await tx.get(configRef);
    if (!configSnap.exists) throw new HttpsError("not-found", "No active week.");
    const config = configSnap.data();

    if (config.spinLocked) {
      throw new HttpsError("failed-precondition", "The wheel has already been spun this week.");
    }
    if (!password || password !== config.weeklyPassword) {
      throw new HttpsError("permission-denied", "Incorrect password.");
    }

    const punishmentsSnap = await db.collection("punishments").get();
    const punishments = punishmentsSnap.docs.map((d) => d.data().text);
    if (punishments.length === 0) {
      throw new HttpsError("failed-precondition", "No punishments have been added yet.");
    }

    const index = Math.floor(Math.random() * punishments.length);
    const result = punishments[index];

    tx.update(configRef, {
      spinLocked: true,
      spinResult: result,
      spinResultIndex: index,
      spunAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { result, index };
  });
});

// Issues a short-lived signed URL so the loser can upload their
// punishment video directly to Storage without needing a Firebase
// Auth account of their own.
exports.getUploadUrl = onCall(async (request) => {
  const { password, fileName, contentType } = request.data || {};
  const configSnap = await db.collection("config").doc("current").get();
  if (!configSnap.exists) throw new HttpsError("not-found", "No active week.");
  const config = configSnap.data();

  if (!config.spinLocked) {
    throw new HttpsError("failed-precondition", "Spin the wheel before uploading a video.");
  }
  if (!password || password !== config.weeklyPassword) {
    throw new HttpsError("permission-denied", "Incorrect password.");
  }

  const safeName = (fileName || "punishment.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `punishment-videos/week-${config.week}-${Date.now()}-${safeName}`;
  const file = bucket.file(path);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 15 * 60 * 1000,
    contentType: contentType || "video/mp4"
  });

  await db.collection("config").doc("current").update({
    videoStoragePath: path
  });

  return { uploadUrl: url, storagePath: path };
});