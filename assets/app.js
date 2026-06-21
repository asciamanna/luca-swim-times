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

function buildPersonalBests(meets) {
  const bests = {};
  for (const meet of meets) {
    for (const event of meet.events) {
      if (event.timeSeconds == null) continue;
      const key = `${event.stroke}-${event.distance}`;
      const current = bests[key];
      if (!current || event.timeSeconds < current.timeSeconds) {
        bests[key] = { ...event, date: meet.date };
      }
    }
  }
  return Object.values(bests).sort((a, b) => a.distance - b.distance || a.stroke.localeCompare(b.stroke));
}

function renderPRCards(bests) {
  const container = document.getElementById("pr-cards");
  container.innerHTML = bests.map(b => `
    <div class="pr-card">
      <div class="stroke">${b.distance}y ${b.stroke}</div>
      <div class="time">${formatTime(b.timeSeconds)}</div>
      <div class="date">${formatDate(b.date)}</div>
    </div>
  `).join("");
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

    const events = meet.events.map(event => `
      <div class="event ${event.isPR ? "pr" : ""}">
        ${event.isPR ? '<span class="star" title="Personal Best">★</span>' : ""}
        <div class="event-name">${event.distance}y ${event.stroke}</div>
        <div class="event-time">${event.time ? formatTime(event.timeSeconds) : "—"}</div>
      </div>
    `).join("");

    return `
      <article class="meet-card">
        <div class="meet-header">
          <h3>SSC vs. ${meet.opponent}</h3>
          <span class="badge ${resultClass}">${resultLabel} ${meet.finalScore.ssc}-${meet.finalScore.opponent}</span>
        </div>
        <div class="meet-meta">${formatDate(meet.date)} • ${homeAway} meet</div>
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

  renderPRCards(buildPersonalBests(meets));
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
