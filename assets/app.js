// Renders Luca's swim history from data/meets.json.
// Note: DQ status/reason exists in the data file for record-keeping but is
// intentionally never rendered here — see CLAUDE.md "DQ handling".

async function loadData() {
  const res = await fetch("data/meets.json");
  return res.json();
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function formatTime(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = (seconds - m * 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  }
  return seconds.toFixed(2);
}

// 1 yard = 0.9144 m, so 50y = 45.72m; factor to convert yard time → meter equivalent
const YARDS_TO_METERS = 50 / 45.72;

function convertTime(seconds, fromUnit, toUnit) {
  if (fromUnit === toUnit) return seconds;
  return fromUnit === "y" ? seconds * YARDS_TO_METERS : seconds / YARDS_TO_METERS;
}

// Stroke display order (matches medley relay order)
const STROKE_ORDER = ["Butterfly", "Backstroke", "Breaststroke", "Freestyle", "Medley"];

function buildPersonalBests(meets) {
  // Returns { stroke → { y: event|null, m: event|null } }
  const bests = {};
  for (const meet of meets) {
    for (const event of meet.events) {
      if (event.timeSeconds == null || event.relay) continue;
      const unit = event.unit ?? "y";
      if (!bests[event.stroke]) bests[event.stroke] = { y: null, m: null };
      const current = bests[event.stroke][unit];
      if (!current || event.timeSeconds < current.timeSeconds) {
        bests[event.stroke][unit] = { ...event, unit, date: meet.date };
      }
    }
  }
  return bests;
}

function renderPRCards(meets) {
  const grouped = buildPersonalBests(meets);
  const strokes = Object.keys(grouped).sort((a, b) => {
    const ai = STROKE_ORDER.indexOf(a);
    const bi = STROKE_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const poolColumn = (event, unit) => {
    const otherUnit = unit === "y" ? "m" : "y";
    const converted = convertTime(event.timeSeconds, unit, otherUnit);
    return `
      <div class="pr-pool pr-pool--${unit === "y" ? "yards" : "meters"}">
        <div class="pr-pool-label">50 ${unit === "y" ? "Yards" : "Meters"}</div>
        <div class="pr-pool-time">${formatTime(event.timeSeconds)}</div>
        <div class="pr-pool-converted">≈ ${formatTime(converted)} in ${otherUnit}</div>
        <div class="pr-pool-date">${formatDate(event.date)}</div>
      </div>`;
  };

  const container = document.getElementById("pr-cards");
  container.innerHTML = strokes.map(stroke => {
    const { y, m } = grouped[stroke];
    return `
      <div class="pr-stroke-card">
        <div class="pr-stroke-header">
          <span class="pr-stroke-name">${stroke}</span>
        </div>
        <div class="pr-pools">
          ${y ? poolColumn(y, "y") : ""}
          ${y && m ? '<div class="pr-lane-divider"></div>' : ""}
          ${m ? poolColumn(m, "m") : ""}
        </div>
      </div>`;
  }).join("");
}

function renderMeets(meets) {
  const container = document.getElementById("meets");
  if (meets.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#6b7c84;">No results match your search.</p>`;
    return;
  }

  container.innerHTML = meets.map(meet => {
    const resultClass = meet.result === "W" ? "win" : meet.result === "L" ? "loss" : "tie";
    const resultLabel = meet.result === "W" ? "WIN" : meet.result === "L" ? "LOSS" : "TIE";
    const homeAway = meet.sscIsHome ? "Home" : "Away";
    const meetTypeLabel = meet.meetType === "JV" ? "JV" : "Varsity";
    const scoreBadge = meet.finalScore
      ? `<span class="badge ${resultClass}">${resultLabel} ${meet.finalScore.ssc}-${meet.finalScore.opponent}</span>`
      : "";

    const events = meet.events.map(event => `
      <div class="event ${event.isPR ? "pr" : ""}">
        ${event.isPR ? '<span class="star" title="Personal Best">★</span>' : ""}
        <div class="event-name">${event.distance}${event.unit ?? "y"} ${event.stroke}${event.relay ? " Relay" : ""}</div>
        <div class="event-time">${event.time ? formatTime(event.timeSeconds) : "—"}</div>
      </div>
    `).join("");

    return `
      <article class="meet-card">
        <div class="meet-header">
          <h3>SSC vs. ${meet.opponent}</h3>
          ${scoreBadge}
        </div>
        <div class="meet-meta">${formatDate(meet.date)} • ${homeAway} • <span class="meet-type-tag">${meetTypeLabel}</span></div>
        <div class="event-list" style="margin-top: 0.9rem;">${events}</div>
      </article>
    `;
  }).join("");
}

function populateStrokeFilter(meets) {
  const select = document.getElementById("stroke-filter");
  const strokes = [...new Set(meets.flatMap(m => m.events.map(e => e.stroke)))].sort();
  for (const stroke of strokes) {
    const opt = document.createElement("option");
    opt.value = stroke;
    opt.textContent = stroke;
    select.appendChild(opt);
  }
}

function applyFilters(meets, query, stroke, order) {
  const q = query.trim().toLowerCase();
  let filtered = meets
    .map(meet => ({
      ...meet,
      events: stroke ? meet.events.filter(e => e.stroke === stroke) : meet.events,
    }))
    .filter(meet => meet.events.length > 0)
    .filter(meet => {
      if (!q) return true;
      const haystack = [meet.opponent, ...meet.events.map(e => `${e.distance} ${e.stroke}`)]
        .join(" ").toLowerCase();
      return haystack.includes(q);
    });

  filtered.sort((a, b) => order === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  return filtered;
}

async function init() {
  const data = await loadData();
  const meets = data.meets;

  renderPRCards(meets);
  populateStrokeFilter(meets);

  const searchInput = document.getElementById("search");
  const strokeFilter = document.getElementById("stroke-filter");
  const sortOrder = document.getElementById("sort-order");

  function update() {
    renderMeets(applyFilters(meets, searchInput.value, strokeFilter.value, sortOrder.value));
  }

  searchInput.addEventListener("input", update);
  strokeFilter.addEventListener("change", update);
  sortOrder.addEventListener("change", update);

  update();
}

init();
