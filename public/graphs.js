"use strict";

let range = "7d";

function dailyPeaks(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const key = new Date(r.ts * 1000).toISOString().slice(0, 10);
    const cur = byDay.get(key) || { ts: r.ts, session: 0, week: 0 };
    cur.session = Math.max(cur.session, r.session || 0);
    cur.week = Math.max(cur.week, r.week || 0);
    byDay.set(key, cur);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({ label: fmtDate(v.ts), values: { session: v.session, week: v.week } }));
}

async function load() {
  const d = await getJSON("/api/history?range=" + range);
  const rows = d.rows || [];
  drawLineChart(document.getElementById("sessionChart"), rows, [{ key: "session", color: COLORS.session }]);
  drawLineChart(document.getElementById("weekChart"), rows, [{ key: "week", color: COLORS.week }]);
  drawBarChart(document.getElementById("dailyChart"), dailyPeaks(rows), [
    { key: "session", color: COLORS.session },
    { key: "week", color: COLORS.week },
  ]);
}

document.getElementById("ranges").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  range = btn.dataset.range;
  document.querySelectorAll("#ranges button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  load();
});
window.addEventListener("resize", load);
load();
setInterval(load, 60000);
