"use strict";

function humanSpan(sec) {
  if (!sec || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function load() {
  const d = await getJSON("/api/stats");
  const s = d.stats || {};
  const set = (id, v) => (document.getElementById(id).textContent = v);

  set("count", s.n || 0);
  set("interval", Math.round((d.poll_interval || 300) / 60) + " min");
  set("since", s.first_ts ? fmtClock(s.first_ts) : "—");
  set("span", s.first_ts && s.last_ts ? humanSpan(s.last_ts - s.first_ts) : "—");

  const setPct = (id, v) => {
    const el = document.getElementById(id);
    el.textContent = fmtPct(v);
    if (v != null) el.style.color = barColor(v);
  };
  setPct("peakSession", s.peak_session);
  setPct("avgSession", s.avg_session);
  setPct("peakWeek", s.peak_week);
  setPct("avgWeek", s.avg_week);
}

load();
setInterval(load, 60000);
