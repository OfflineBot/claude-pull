"use strict";

const LIMIT = 50;
let offset = 0;
let total = 0;

function cell(v, isPct) {
  if (v == null) return "—";
  return isPct ? Math.round(v) + "%" : v;
}

async function load() {
  const d = await getJSON(`/api/raw?limit=${LIMIT}&offset=${offset}`);
  total = d.total || 0;
  const tb = document.getElementById("rows");
  tb.innerHTML = "";
  for (const r of d.rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="muted">${r.id}</td>` +
      `<td>${fmtClock(r.ts)}</td>` +
      `<td style="color:${barColor(r.session || 0)}">${cell(r.session, true)}</td>` +
      `<td style="color:${barColor(r.week || 0)}">${cell(r.week, true)}</td>` +
      `<td>${cell(r.opus, true)}</td>` +
      `<td>${cell(r.sonnet, true)}</td>`;
    tb.appendChild(tr);
  }
  if (!d.rows.length) tb.innerHTML = `<tr><td colspan="6" class="muted center">no data yet</td></tr>`;

  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + LIMIT, total);
  document.getElementById("pageInfo").textContent = `${from}–${to} of ${total}`;
  document.getElementById("prev").disabled = offset === 0;
  document.getElementById("next").disabled = offset + LIMIT >= total;
}

document.getElementById("prev").addEventListener("click", () => {
  offset = Math.max(0, offset - LIMIT); load();
});
document.getElementById("next").addEventListener("click", () => {
  if (offset + LIMIT < total) { offset += LIMIT; load(); }
});
load();
