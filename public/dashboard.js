"use strict";

function setCard(key, pct, resets) {
  const v = pct == null ? null : Number(pct);
  document.getElementById(key + "Pct").textContent = fmtPct(v);
  const bar = document.getElementById(key + "Bar");
  bar.style.width = (v == null ? 0 : Math.min(100, v)) + "%";
  bar.style.background = barColor(v == null ? 0 : v);
  document.getElementById(key + "Resets").textContent = resetHint(resets);
}

async function loadCurrent() {
  const d = await getJSON("/api/current");
  document.getElementById("interval").textContent = Math.round((d.poll_interval || 300) / 60);

  const errBox = document.getElementById("error");
  if (d.error && d.error.msg) { errBox.hidden = false; errBox.textContent = "Last fetch failed: " + d.error.msg; }
  else errBox.hidden = true;

  const l = d.latest;
  if (!l) { document.getElementById("updated").textContent = "no data yet"; return; }
  document.getElementById("updated").textContent = "updated " + fmtClock(l.ts);
  setCard("session", l.session, l.session_resets);
  setCard("week", l.week, l.week_resets);
}

async function loadChart() {
  const d = await getJSON("/api/history?range=7d");
  drawLineChart(document.getElementById("chart"), d.rows || [], [
    { key: "session", color: COLORS.session },
    { key: "week", color: COLORS.week },
  ]);
}

async function refreshAll() { await Promise.all([loadCurrent(), loadChart()]); }

document.getElementById("refresh").addEventListener("click", async () => {
  try { await fetch("/api/poll"); } catch (_) {}
  refreshAll();
});
window.addEventListener("resize", loadChart);
refreshAll();
setInterval(refreshAll, 60000);
