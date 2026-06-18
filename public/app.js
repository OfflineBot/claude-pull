"use strict";

// mirrors the user's active kitty palette (see style.css)
const COLORS = {
  session: "#95b894",   // kitty color2 (green)
  week: "#8fbed1",      // kitty color6 (cyan)
  grid: "rgba(74,91,120,0.22)",
  axis: "rgba(213,221,232,0.45)",
};

let currentRange = "7d";

function barColor(pct) {
  if (pct >= 90) return "#d8909a";   // kitty color1 (red)
  if (pct >= 70) return "#d4b97a";   // kitty color3 (yellow)
  return "#95b894";                  // kitty color2 (green)
}

function fmtClock(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function resetHint(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  let s = Math.max(0, (t - Date.now()) / 1000);
  if (s < 3600) return "resets in " + Math.max(1, Math.round(s / 60)) + "m";
  if (s < 86400) return "resets in " + Math.round(s / 3600) + "h";
  return "resets in " + Math.round(s / 86400) + "d";
}

async function loadCurrent() {
  const r = await fetch("/api/current");
  const d = await r.json();
  const errBox = document.getElementById("error");

  document.getElementById("interval").textContent = Math.round((d.poll_interval || 300) / 60);

  if (d.error && d.error.msg) {
    errBox.hidden = false;
    errBox.textContent = "Last fetch failed: " + d.error.msg;
  } else {
    errBox.hidden = true;
  }

  const l = d.latest;
  if (!l) {
    document.getElementById("updated").textContent = "no data yet";
    return;
  }
  document.getElementById("updated").textContent = "updated " + fmtClock(l.ts);

  setCard("session", l.session, l.session_resets);
  setCard("week", l.week, l.week_resets);
}

function setCard(key, pct, resets) {
  const v = pct == null ? null : Number(pct);
  document.getElementById(key + "Pct").textContent = v == null ? "—" : Math.round(v) + "%";
  const bar = document.getElementById(key + "Bar");
  bar.style.width = (v == null ? 0 : Math.min(100, v)) + "%";
  bar.style.background = barColor(v == null ? 0 : v);
  document.getElementById(key + "Resets").textContent = resetHint(resets);
}

async function loadHistory() {
  const r = await fetch("/api/history?range=" + currentRange);
  const d = await r.json();
  drawChart(d.rows || []);
}

function drawChart(rows) {
  const canvas = document.getElementById("chart");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 280;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 36, padR = 12, padT = 14, padB = 26;
  const W = cssW - padL - padR;
  const H = cssH - padT - padB;

  // y axis 0..100 with gridlines
  ctx.font = "11px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (let p = 0; p <= 100; p += 25) {
    const y = padT + H - (p / 100) * H;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + W, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.axis;
    ctx.textAlign = "right";
    ctx.fillText(p + "%", padL - 6, y);
  }

  if (rows.length === 0) {
    ctx.fillStyle = COLORS.axis;
    ctx.textAlign = "center";
    ctx.fillText("no samples in this range yet", padL + W / 2, padT + H / 2);
    return;
  }

  const t0 = rows[0].ts;
  const t1 = rows[rows.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const xOf = (ts) => padL + ((ts - t0) / span) * W;
  const yOf = (v) => padT + H - (Math.min(100, Math.max(0, v)) / 100) * H;

  const series = [
    { key: "session", color: COLORS.session },
    { key: "week", color: COLORS.week },
  ];
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (const row of rows) {
      const val = row[s.key];
      if (val == null) continue;
      const x = xOf(row.ts), y = yOf(val);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // x axis time labels (start / mid / end)
  ctx.fillStyle = COLORS.axis;
  ctx.textBaseline = "top";
  const labels = [t0, t0 + span / 2, t1];
  const aligns = ["left", "center", "right"];
  labels.forEach((ts, i) => {
    ctx.textAlign = aligns[i];
    const x = i === 0 ? padL : i === 2 ? padL + W : padL + W / 2;
    ctx.fillText(fmtClock(ts), x, padT + H + 6);
  });
}

function setupRanges() {
  document.getElementById("ranges").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    currentRange = btn.dataset.range;
    document.querySelectorAll("#ranges button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    loadHistory();
  });
}

async function refreshAll() {
  await Promise.all([loadCurrent(), loadHistory()]);
}

document.getElementById("refresh").addEventListener("click", async () => {
  try { await fetch("/api/poll"); } catch (_) {}
  refreshAll();
});

setupRanges();
refreshAll();
setInterval(refreshAll, 60000);            // live-ish refresh
window.addEventListener("resize", loadHistory);
