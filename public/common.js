"use strict";

// mirrors the user's active kitty palette (see style.css)
const COLORS = {
  session: "#95b894",   // kitty color2 (green)
  week: "#8fbed1",      // kitty color6 (cyan)
  grid: "rgba(74,91,120,0.22)",
  axis: "rgba(213,221,232,0.45)",
};

function barColor(pct) {
  if (pct >= 90) return "#d8909a";   // kitty color1 (red)
  if (pct >= 70) return "#d4b97a";   // kitty color3 (yellow)
  return "#95b894";                  // kitty color2 (green)
}

function fmtClock(ts) {
  return new Date(ts * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtPct(v) { return v == null ? "—" : Math.round(v) + "%"; }

function resetHint(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, (t - Date.now()) / 1000);
  if (s < 3600) return "resets in " + Math.max(1, Math.round(s / 60)) + "m";
  if (s < 86400) return "resets in " + Math.round(s / 3600) + "h";
  return "resets in " + Math.round(s / 86400) + "d";
}

async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

// highlight the active nav link by current path
function markNav() {
  const here = location.pathname === "/" ? "/" : location.pathname;
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.getAttribute("href") === here) a.classList.add("active");
  });
}

// shared canvas setup (handles HiDPI); returns drawing context + geometry
function prep(canvas, height = 280) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  canvas.width = cssW * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, height);
  return { ctx, W: cssW, H: height };
}

// line chart over time, y axis fixed 0..100 (%)
function drawLineChart(canvas, rows, series) {
  const { ctx, W, H } = prep(canvas);
  const padL = 38, padR = 14, padT = 14, padB = 26;
  const w = W - padL - padR, h = H - padT - padB;

  ctx.font = "11px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (let p = 0; p <= 100; p += 25) {
    const y = padT + h - (p / 100) * h;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.textAlign = "right";
    ctx.fillText(p + "%", padL - 6, y);
  }

  if (!rows.length) {
    ctx.fillStyle = COLORS.axis; ctx.textAlign = "center";
    ctx.fillText("no samples in this range yet", padL + w / 2, padT + h / 2);
    return;
  }

  const t0 = rows[0].ts, t1 = rows[rows.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const xOf = (ts) => padL + ((ts - t0) / span) * w;
  const yOf = (v) => padT + h - (Math.min(100, Math.max(0, v)) / 100) * h;

  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (const row of rows) {
      const val = row[s.key];
      if (val == null) continue;
      const x = xOf(row.ts), y = yOf(val);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
    }
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.axis; ctx.textBaseline = "top";
  [["left", t0, padL], ["center", t0 + span / 2, padL + w / 2], ["right", t1, padL + w]]
    .forEach(([align, ts, x]) => { ctx.textAlign = align; ctx.fillText(fmtClock(ts), x, padT + h + 6); });
}

// grouped vertical bars; groups: [{label, values:{key:num}}], series: [{key,color}]
function drawBarChart(canvas, groups, series) {
  const { ctx, W, H } = prep(canvas, 260);
  const padL = 38, padR = 14, padT = 14, padB = 26;
  const w = W - padL - padR, h = H - padT - padB;

  ctx.font = "11px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (let p = 0; p <= 100; p += 25) {
    const y = padT + h - (p / 100) * h;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.textAlign = "right";
    ctx.fillText(p + "%", padL - 6, y);
  }
  if (!groups.length) {
    ctx.fillStyle = COLORS.axis; ctx.textAlign = "center";
    ctx.fillText("no data yet", padL + w / 2, padT + h / 2);
    return;
  }

  const slot = w / groups.length;
  const barW = Math.min(22, (slot * 0.7) / series.length);
  groups.forEach((g, i) => {
    const cx = padL + slot * i + slot / 2;
    const total = barW * series.length;
    series.forEach((s, j) => {
      const v = g.values[s.key] || 0;
      const bh = (Math.min(100, v) / 100) * h;
      const x = cx - total / 2 + j * barW;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, padT + h - bh, barW - 2, bh);
    });
    if (i % Math.ceil(groups.length / 8 || 1) === 0) {
      ctx.fillStyle = COLORS.axis; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(g.label, cx, padT + h + 6);
      ctx.textBaseline = "middle";
    }
  });
}

markNav();
