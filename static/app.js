"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const fmt = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (abs >= 1e3) return Math.round(n / 1e3) + "k";
  return Math.round(n).toString();
};
const money = (n) => "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Estado
const state = {
  movements: [],
  result: null,
};

// ── Movimientos ──────────────────────────────────────────
function addMovement(data = {}) {
  const tpl = $("#mov-template").content.cloneNode(true);
  const row = tpl.querySelector(".mov-row");
  const today = new Date().toISOString().slice(0, 10);

  row.querySelector(".mov-label").value = data.label || "";
  row.querySelector(".mov-value").value = data.value != null ? Math.abs(data.value) : "";
  row.querySelector(".mov-sign").value = data.sign || (data.value < 0 ? "-1" : "1");
  row.querySelector(".mov-date").value = data.date || today;
  row.querySelector(".mov-rec").value = data.recurrence || "none";
  row.querySelector(".mov-medio").value = data.medio || "transferencia";

  row.querySelectorAll("input, select").forEach((el) =>
    el.addEventListener("input", () => { project(); })
  );
  row.querySelector(".mov-del").addEventListener("click", () => {
    row.remove();
    project();
  });
  $("#mov-list").appendChild(row);
}

function readMovements() {
  return $$(".mov-row").map((row) => {
    const value = parseFloat(row.querySelector(".mov-value").value) || 0;
    const sign = parseInt(row.querySelector(".mov-sign").value, 10);
    return {
      label: row.querySelector(".mov-label").value,
      amount: value * sign,
      date: row.querySelector(".mov-date").value,
      recurrence: row.querySelector(".mov-rec").value,
      medio: row.querySelector(".mov-medio").value,
    };
  }).filter((m) => m.amount !== 0 && m.date);
}

// ── Proyección ───────────────────────────────────────────
async function project() {
  const body = {
    opening_balance: parseFloat($("#opening").value) || 0,
    min_buffer: parseFloat($("#buffer").value) || 0,
    horizon_days: parseInt($("#horizon").value, 10),
    movements: readMovements(),
  };
  try {
    const res = await fetch("/api/cashflow/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.result = await res.json();
    renderKPIs();
    renderChart();
    renderCashflowTable();
    renderInsights();
    renderExcedente();
  } catch (e) {
    console.error("Error al proyectar:", e);
  }
}

// ── KPIs ─────────────────────────────────────────────────
function renderKPIs() {
  const s = state.result.summary;
  const netClass = s.net_change >= 0 ? "pos" : "neg";
  const minClass = s.min_balance < s.min_buffer ? "neg" : "";
  $("#kpi-row").innerHTML = `
    <div class="kpi hero">
      <div class="kpi-label">Excedente colocable</div>
      <div class="kpi-value">${money(s.stable_surplus)}</div>
      <div class="kpi-sub">Sin tocar el colchón en ${s.horizon_days} días</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Saldo hoy → fin</div>
      <div class="kpi-value ${netClass}">${money(s.closing_balance)}</div>
      <div class="kpi-sub">${s.net_change >= 0 ? "+" : ""}${money(s.net_change)} en el período</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Piso de caja</div>
      <div class="kpi-value ${minClass}">${money(s.min_balance)}</div>
      <div class="kpi-sub">El ${fmtDate(s.min_balance_date)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Movido en el período</div>
      <div class="kpi-value">${money(s.total_inflow)}</div>
      <div class="kpi-sub">entra · sale ${money(s.total_outflow)}</div>
    </div>`;
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// ── Chart (SVG) ──────────────────────────────────────────
function renderChart() {
  const days = state.result.days;
  const buffer = state.result.summary.min_buffer;
  if (!days.length) return;

  const W = 900, H = 340, P = { t: 20, r: 20, b: 34, l: 62 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;

  const balances = days.map((d) => d.balance);
  let ymin = Math.min(0, ...balances, buffer);
  let ymax = Math.max(...balances, buffer);
  const pad = (ymax - ymin) * 0.1 || 1000;
  ymin -= pad; ymax += pad;

  const X = (i) => P.l + (i / (days.length - 1)) * iw;
  const Y = (v) => P.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

  const linePath = days.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(d.balance).toFixed(1)}`).join("");
  const areaPath = `${linePath}L${X(days.length - 1).toFixed(1)},${Y(ymin).toFixed(1)}L${X(0).toFixed(1)},${Y(ymin).toFixed(1)}Z`;

  // Y gridlines
  const yticks = 5;
  let grid = "";
  for (let i = 0; i <= yticks; i++) {
    const v = ymin + (i / yticks) * (ymax - ymin);
    const y = Y(v).toFixed(1);
    grid += `<line class="grid-line" x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}"/>`;
    grid += `<text class="axis-label" x="${P.l - 8}" y="${+y + 4}" text-anchor="end">${fmt(v)}</text>`;
  }

  // X labels (mostrar ~6)
  const step = Math.max(1, Math.floor(days.length / 6));
  let xlabels = "";
  for (let i = 0; i < days.length; i += step) {
    xlabels += `<text class="axis-label" x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle">${fmtDate(days[i].date)}</text>`;
  }

  const bufferY = Y(buffer).toFixed(1);
  const zeroY = ymin < 0 ? Y(0).toFixed(1) : null;

  $("#chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563EB" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#2563EB" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      ${grid}
      ${xlabels}
      <path class="balance-area" d="${areaPath}"/>
      <path class="balance-line" d="${linePath}"/>
      <line class="buffer-line" x1="${P.l}" y1="${bufferY}" x2="${W - P.r}" y2="${bufferY}"/>
      ${zeroY ? `<line class="zero-line" x1="${P.l}" y1="${zeroY}" x2="${W - P.r}" y2="${zeroY}"/>` : ""}
      <g id="hover-g" style="opacity:0">
        <line class="hover-line" id="hover-line" x1="0" y1="${P.t}" x2="0" y2="${P.t + ih}"/>
        <circle class="hover-dot" id="hover-dot" r="4.5"/>
      </g>
      <rect id="chart-overlay" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>
    <div class="chart-tip" id="chart-tip"></div>`;

  wireChartHover(days, X, Y, P, iw);
}

function wireChartHover(days, X, Y, P, iw) {
  const svg = $("#chart svg");
  const overlay = $("#chart-overlay");
  const g = $("#hover-g");
  const dot = $("#hover-dot");
  const line = $("#hover-line");
  const tip = $("#chart-tip");
  const chartBox = $("#chart");

  overlay.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = 900 / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    let i = Math.round(((svgX - P.l) / iw) * (days.length - 1));
    i = Math.max(0, Math.min(days.length - 1, i));
    const d = days[i];
    const cx = X(i), cy = Y(d.balance);
    g.style.opacity = "1";
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    line.setAttribute("x1", cx); line.setAttribute("x2", cx);

    tip.style.opacity = "1";
    tip.innerHTML = `
      <div class="tip-date">${fmtDate(d.date)}</div>
      <div class="tip-row"><span>Saldo</span><b>${money(d.balance)}</b></div>
      ${d.inflow ? `<div class="tip-row"><span>Entra</span><b>+${fmt(d.inflow)}</b></div>` : ""}
      ${d.outflow ? `<div class="tip-row"><span>Sale</span><b>−${fmt(d.outflow)}</b></div>` : ""}
      <div class="tip-row"><span>Colocable</span><b>${money(d.investable)}</b></div>`;
    const boxRect = chartBox.getBoundingClientRect();
    const px = (cx / 900) * boxRect.width;
    let left = px + 14;
    if (left + 170 > boxRect.width) left = px - 184;
    tip.style.left = Math.max(0, left) + "px";
    tip.style.top = ((cy / 340) * boxRect.height - 10) + "px";
  });
  overlay.addEventListener("mouseleave", () => {
    g.style.opacity = "0";
    tip.style.opacity = "0";
  });
}

// ── Tabla estilo Excel (día / semana, con detalle) ──────
function renderCashflowTable() {
  const days = state.result.days;
  if (!days.length) return;
  const grain = state.cfGrain || "dia";

  if (grain === "semana") return renderTableWeekly(days);
  return renderTableDaily(days);
}

function renderTableDaily(days) {
  // Mostrar días con movimiento + permitir expandir para ver el detalle
  const withMov = days.filter((d) => d.inflow || d.outflow);
  const movByDate = getMovementsByDate();

  const rows = withMov.map((d) => {
    const detail = movByDate[d.date] || [];
    const open = state.cfOpenDay === d.date;
    const alert = d.negative ? "row-neg" : d.below_buffer ? "row-warn" : "";
    const main = `<tr class="cf-row ${alert}" data-day="${d.date}">
      <td class="cf-caret">${detail.length ? (open ? "▾" : "▸") : ""}</td>
      <td class="cf-date">${fmtDateFull(d.date)}</td>
      <td class="${d.inflow ? "in" : "muted"}">${d.inflow ? "+" + money(d.inflow) : "—"}</td>
      <td class="${d.outflow ? "out" : "muted"}">${d.outflow ? "−" + money(d.outflow) : "—"}</td>
      <td class="${d.net > 0 ? "in" : d.net < 0 ? "out" : "muted"}">${d.net ? (d.net > 0 ? "+" : "") + money(d.net) : "—"}</td>
      <td class="bal ${d.negative ? "neg" : d.below_buffer ? "warn" : ""}">${money(d.balance)}</td>
      <td class="${d.investable ? "inv" : "muted"}">${d.investable ? money(d.investable) : "—"}</td>
    </tr>`;
    let detailRows = "";
    if (open && detail.length) {
      detailRows = detail.map((m) => `<tr class="cf-detail">
        <td></td>
        <td class="cf-detail-label" colspan="1">${h(m.label || "(sin concepto)")}</td>
        <td class="${m.amount > 0 ? "in" : "muted"}">${m.amount > 0 ? "+" + money(m.amount) : "—"}</td>
        <td class="${m.amount < 0 ? "out" : "muted"}">${m.amount < 0 ? "−" + money(Math.abs(m.amount)) : "—"}</td>
        <td colspan="1" class="cf-medio">${medioLabel(m.medio)}</td>
        <td colspan="2"></td>
      </tr>`).join("");
    }
    return main + detailRows;
  }).join("");

  $("#cf-table").innerHTML = `
    <div class="cf-table-scroll">
      <table class="cf-table">
        <thead><tr>
          <th></th><th>Fecha</th><th>Entra</th><th>Sale</th><th>Neto</th><th>Saldo</th><th>Colocable</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="cf-table-foot">
      <span>${withMov.length} días con movimiento · tocá una fila para ver el detalle</span>
    </div>`;

  $$(".cf-row").forEach((row) => {
    row.onclick = () => {
      const day = row.dataset.day;
      state.cfOpenDay = state.cfOpenDay === day ? null : day;
      renderCashflowTable();
    };
  });
  wireExport();
}

function renderTableWeekly(days) {
  // Agrupar por semana (lunes a domingo)
  const weeks = {};
  days.forEach((d) => {
    const date = new Date(d.date + "T00:00:00");
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { from: key, inflow: 0, outflow: 0, endBal: 0, minBal: Infinity, investable: Infinity, days: [] };
    const w = weeks[key];
    w.inflow += d.inflow; w.outflow += d.outflow;
    w.endBal = d.balance;
    w.minBal = Math.min(w.minBal, d.balance);
    w.investable = Math.min(w.investable, d.investable);
    w.days.push(d);
  });

  const rows = Object.values(weeks).map((w) => {
    const to = w.days[w.days.length - 1].date;
    const net = w.inflow - w.outflow;
    const alert = w.minBal < 0 ? "row-neg" : "";
    return `<tr class="${alert}">
      <td></td>
      <td class="cf-date">${fmtDateShort(w.from)} – ${fmtDateShort(to)}</td>
      <td class="${w.inflow ? "in" : "muted"}">${w.inflow ? "+" + money(w.inflow) : "—"}</td>
      <td class="${w.outflow ? "out" : "muted"}">${w.outflow ? "−" + money(w.outflow) : "—"}</td>
      <td class="${net > 0 ? "in" : net < 0 ? "out" : "muted"}">${net ? (net > 0 ? "+" : "") + money(net) : "—"}</td>
      <td class="bal">${money(w.endBal)}</td>
      <td class="${w.investable > 0 ? "inv" : "muted"}">${w.investable > 0 ? money(w.investable) : "—"}</td>
    </tr>`;
  }).join("");

  $("#cf-table").innerHTML = `
    <div class="cf-table-scroll">
      <table class="cf-table">
        <thead><tr>
          <th></th><th>Semana</th><th>Entra</th><th>Sale</th><th>Neto</th><th>Saldo fin</th><th>Colocable mín.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="cf-table-foot"><span>${Object.keys(weeks).length} semanas · saldo al cierre y excedente mínimo de cada una</span></div>`;
  wireExport();
}

// Construye {fecha: [movimientos]} expandiendo recurrencias, para el detalle diario
function getMovementsByDate() {
  const movs = readMovements();
  const byDate = {};
  const start = new Date();
  const end = new Date(); end.setDate(end.getDate() + 400);
  movs.forEach((m) => {
    const base = new Date(m.date + "T00:00:00");
    const push = (iso) => { (byDate[iso] = byDate[iso] || []).push(m); };
    if (m.recurrence === "none") { push(m.date); return; }
    let d = new Date(base), guard = 0;
    while (d <= end && guard < 500) {
      push(d.toISOString().slice(0, 10));
      if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
      else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
      else break;
      guard++;
    }
  });
  return byDate;
}

function medioLabel(medio) {
  const map = { transferencia: "🏦 Transferencia", efectivo: "💵 Efectivo", cheque: "🧾 Cheque", tarjeta: "💳 Tarjeta" };
  return map[medio] || medio || "—";
}

function wireExport() {
  const exp = $("#cf-export");
  if (exp) exp.onclick = exportCashflowCSV;
}

function fmtDateFull(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", weekday: "short" });
}
function fmtDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function exportCashflowCSV() {
  const days = state.result.days;
  const header = "Fecha,Entra,Sale,Neto,Saldo,Colocable\n";
  const lines = days.map((d) =>
    [d.date, d.inflow || 0, d.outflow || 0, d.net || 0, d.balance, d.investable || 0].join(",")
  ).join("\n");
  const blob = new Blob([header + lines], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "flujo_de_caja.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Insights ─────────────────────────────────────────────
function renderInsights() {
  const s = state.result.summary;
  const shortfalls = state.result.shortfalls;
  const out = [];

  if (s.stable_surplus > 0) {
    out.push({
      kind: "good", icon: "◆",
      title: "Tenés plata ociosa para invertir",
      html: `Hay <span class="amt">${money(s.stable_surplus)}</span> que podés colocar sin tocar el colchón en todo el horizonte. Puesto en un FCI money market, ese dinero rinde todos los días con liquidez inmediata.`,
      cta: "Ver opciones",
    });
  }

  if (s.has_shortfall) {
    const first = shortfalls.find((x) => true);
    out.push({
      kind: "bad", icon: "▲",
      title: "Vas a quedar en descubierto",
      html: `El saldo cae por debajo de cero${first ? ` alrededor del <span class="amt">${fmtDate(first.from)}</span>` : ""}. Conviene adelantar cobranzas, postergar pagos o dejar una línea disponible.`,
    });
  } else if (s.min_balance < s.min_buffer) {
    out.push({
      kind: "warn", icon: "▲",
      title: "El colchón se perfora",
      html: `El saldo baja hasta <span class="amt">${money(s.min_balance)}</span> el ${fmtDate(s.min_balance_date)}, por debajo del colchón que fijaste. No es descubierto, pero ajustá el margen antes de invertir de más.`,
    });
  }

  if (!out.length) {
    out.push({
      kind: "warn", icon: "○",
      title: "Cargá tus movimientos",
      html: `Agregá las cobranzas y pagos previstos para ver la proyección y cuánto podés invertir.`,
    });
  }

  $("#insights").innerHTML = out.map((i) => `
    <div class="insight ${i.kind}">
      <div class="insight-icon">${i.icon}</div>
      <div class="insight-body">
        <h3>${i.title}</h3>
        <p>${i.html}</p>
      </div>
      ${i.cta ? `<button class="insight-cta" data-goto="excedente">${i.cta}</button>` : ""}
    </div>`).join("");

  $$(".insight-cta").forEach((btn) =>
    btn.addEventListener("click", () => switchView("excedente"))
  );
}

// ── Excedente (placeholder con datos del cash flow) ──────
function renderExcedente() {
  if (!state.result) return;
  const s = state.result.summary;
  const surplus = s.stable_surplus;
  $("#excedente-wrap").innerHTML = `
    <div class="exc-hero">
      <div class="eyebrow">Excedente colocable</div>
      <div class="big">${money(surplus)}</div>
      <p class="sub">Es lo máximo que podés invertir hoy sin que el saldo perfore tu colchón de ${money(s.min_buffer)} en los próximos ${s.horizon_days} días.</p>
    </div>
    <div class="opt-grid">
      <div class="opt-card">
        <span class="opt-tag liq">Liquidez inmediata</span>
        <h3>FCI Money Market</h3>
        <p style="font-size:13px;color:var(--slate)">Rescate en el día (T+0). Ideal para plata que podés necesitar en cualquier momento.</p>
        <div class="opt-rows">
          <div><span>Horizonte</span><b>Cualquiera</b></div>
          <div><span>Riesgo</span><b>Muy bajo</b></div>
          <div><span>Liquidez</span><b>Inmediata</b></div>
        </div>
      </div>
      <div class="opt-card">
        <span class="opt-tag mid">Plazo fijo</span>
        <h3>ONs y bonos</h3>
        <p style="font-size:13px;color:var(--slate)">Mayor rendimiento si podés inmovilizar el excedente un tiempo definido.</p>
        <div class="opt-rows">
          <div><span>Horizonte</span><b>Definido</b></div>
          <div><span>Riesgo</span><b>Bajo-medio</b></div>
          <div><span>Liquidez</span><b>Al vencimiento</b></div>
        </div>
      </div>
    </div>
    <p class="exc-note">Elegí un instrumento y simulá el flujo de cobros en la sección Inversiones.</p>
    <div style="text-align:center;margin-top:16px">
      <button class="btn-primary" id="exc-invest-btn" style="width:auto;padding:12px 28px">Invertir el excedente →</button>
    </div>`;
  const btn = $("#exc-invest-btn");
  if (btn) btn.addEventListener("click", () => switchView("inversiones"));
}

// ── Inversiones ──────────────────────────────────────────
async function renderInversiones() {
  const surplus = state.result ? state.result.summary.stable_surplus : 0;
  const wrap = $("#inv-wrap");
  wrap.innerHTML = `
    <div class="inv-head">
      <div>
        <div class="eyebrow">Invertir el excedente</div>
        <h2 class="inv-title">Colocá ${money(surplus)} en renta fija</h2>
        <p class="inv-sub">Elegí un instrumento y simulá cuánto y cuándo vas a cobrar. Los flujos salen del cronograma real de cada bono.</p>
      </div>
    </div>
    <div class="inv-board">
      <aside class="inv-controls ctrl-card">
        <label class="field">
          <span>Tipo</span>
          <select id="inv-kind">
            <option value="fci">FCI Money Market</option>
            <option value="caucion">Caución bursátil</option>
            <option value="plazofijo">Plazo fijo</option>
            <option value="lecap">Letra (LECAP)</option>
            <option value="soberano">Bono soberano</option>
            <option value="on">Obligación negociable</option>
          </select>
        </label>
        <div id="inv-fci-controls">
          <label class="field">
            <span>Monto a invertir</span>
            <div class="money-input"><em>$</em><input type="number" id="fci-amount" value="${Math.round(surplus)}" step="1000"></div>
            <small>Precargado con tu excedente colocable.</small>
          </label>
          <label class="field">
            <span>Días</span>
            <input type="number" id="fci-days" value="30" step="1" min="1">
            <small>Cuánto tiempo lo dejás colocado.</small>
          </label>
        </div>
        <div id="inv-bond-controls" class="hidden">
          <label class="field">
            <span>Instrumento</span>
            <select id="inv-symbol"><option value="">— cargando —</option></select>
          </label>
          <label class="field">
            <span>Monto a invertir</span>
            <div class="money-input"><em>$</em><input type="number" id="inv-amount" value="${Math.round(surplus)}" step="1000"></div>
          </label>
          <label class="field">
            <span>Precio (por 100 VN)</span>
            <input type="number" id="inv-price" value="72.5" step="0.01">
          </label>
        </div>
        <button class="btn-primary" id="inv-sim-btn">Simular inversión</button>
      </aside>
      <div class="inv-result" id="inv-result">
        <div class="inv-placeholder">Elegí un instrumento y tocá simular.</div>
      </div>
    </div>`;

  // Alternar controles según tipo
  const toggleControls = () => {
    const kind = $("#inv-kind").value;
    const simple = (kind === "fci" || kind === "caucion" || kind === "plazofijo");
    $("#inv-fci-controls").classList.toggle("hidden", !simple);
    $("#inv-bond-controls").classList.toggle("hidden", simple);
    // Para LECAP el precio lo trae el mercado, ocultamos el input de precio manual
    const priceField = $("#inv-price") ? $("#inv-price").closest(".field") : null;
    if (priceField) priceField.classList.toggle("hidden", kind === "lecap");
  };
  toggleControls();

  // Cargar instrumentos de bonos/lecaps según tipo
  const loadSymbols = async () => {
    const kind = $("#inv-kind").value;
    if (kind === "fci" || kind === "caucion" || kind === "plazofijo") return;
    let url, key, items;
    if (kind === "lecap") { url = "/api/inversiones/lecaps"; key = "lecaps"; }
    else if (kind === "soberano") { url = "/api/inversiones/soberanos"; key = "bonds"; }
    else { url = "/api/inversiones/ons"; key = "ons"; }
    const res = await fetch(url);
    const data = await res.json();
    items = data[key] || [];
    const sel = $("#inv-symbol");
    if (!items.length && kind === "lecap") {
      sel.innerHTML = `<option value="">— sin LECAPs en vivo (requiere BYMA) —</option>`;
      return;
    }
    sel.innerHTML = items.map((b) =>
      `<option value="${b.symbol || b.ticker}">${b.symbol || b.ticker}${b.name ? " · "+b.name : b.tipo ? " · "+b.tipo : ""}</option>`).join("");
  };
  await loadSymbols();

  const runFci = async () => {
    const amount = parseFloat($("#fci-amount").value);
    const days = parseInt($("#fci-days").value, 10);
    if (!amount || !days) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Buscando los mejores fondos…</div>`;
    try {
      const mmRes = await fetch("/api/fci/money-market");
      const mm = await mmRes.json();
      const funds = mm.funds || [];
      if (!funds.length) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">No se pudieron cargar los fondos.</div>`;
        return;
      }
      // Proyectar con el mejor fondo (mayor TNA)
      const best = funds[0];
      const projRes = await fetch(`/api/fci/simular?amount=${amount}&tna=${best.tna}&days=${days}`);
      const proj = await projRes.json();
      const srcNote = mm.source === "CAFCI"
        ? `Datos en vivo de CAFCI (${mm.live_count} fondos)`
        : "Tasas de referencia — conectá CAFCI en el servidor para datos en vivo";

      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>FCI Money Market</h3>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(proj.amount)}</b></div>
            <div class="inv-kpi"><small>Mejor TNA</small><b class="pos">${num(best.tna)}%</b></div>
            <div class="inv-kpi"><small>Ganás en ${days}d</small><b class="pos">${money(proj.interest)}</b></div>
            <div class="inv-kpi"><small>Total</small><b>${money(proj.final)}</b></div>
          </div>
          <div class="inv-break">
            <span>Devengás <b>${money(proj.daily_accrual)}</b> por día</span>
            <span>Liquidez <b>inmediata (T+0)</b></span>
            <span>Riesgo <b>muy bajo</b></span>
          </div>
        </div>
        <div class="inv-schedule">
          <h4>Fondos disponibles <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Fondo</th><th>Administradora</th><th>TNA</th><th>Ganás en ${days}d</th></tr></thead>
            <tbody>${funds.map((f) => {
              const g = amount * (f.tna/100/365) * days;
              return `<tr>
                <td><b>${f.name}</b></td>
                <td>${f.manager}</td>
                <td><span class="tag-coupon">${num(f.tna)}%</span></td>
                <td>${money(g)}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>`;
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runTasa = async (kind) => {
    const amount = parseFloat($("#fci-amount").value);
    const days = parseInt($("#fci-days").value, 10);
    if (!amount || !days) return;
    const isCaucion = kind === "caucion";
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Buscando tasas…</div>`;
    try {
      const url = isCaucion ? "/api/tasas/caucion" : "/api/tasas/plazo-fijo";
      const data = await (await fetch(url)).json();
      const bestTna = isCaucion ? data.tna_1d : data.best_tna;
      const proj = await (await fetch(`/api/tasas/simular?amount=${amount}&tna=${bestTna}&days=${days}`)).json();
      const srcNote = data.source === "referencia"
        ? "Tasa de referencia — conectá la fuente en el servidor para datos en vivo"
        : `Datos en vivo de ${data.source}`;

      let listHtml = "";
      if (isCaucion && data.plazos && data.plazos.length > 1) {
        listHtml = `<div class="inv-schedule">
          <h4>Curva de tasas por plazo <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Plazo</th><th>TNA</th><th>Ganás en ese plazo</th></tr></thead>
            <tbody>${data.plazos.map((p) => {
              const g = amount * (p.tna/100) * (p.days/365);
              return `<tr><td>${p.days} día${p.days>1?"s":""}</td><td><span class="tag-coupon">${num(p.tna)}%</span></td><td>${money(g)}</td></tr>`;
            }).join("")}</tbody>
          </table></div>`;
      } else if (!isCaucion && data.banks) {
        listHtml = `<div class="inv-schedule">
          <h4>Tasas por banco <small style="font-weight:400;color:var(--slate-2)">· ${srcNote}</small></h4>
          <table class="inv-table">
            <thead><tr><th>Banco</th><th>TNA</th><th>Ganás en ${days}d</th></tr></thead>
            <tbody>${data.banks.slice(0, 15).map((b) => {
              const g = amount * (b.tna/100) * (days/365);
              return `<tr><td><b>${b.bank}</b></td><td><span class="tag-coupon">${num(b.tna)}%</span></td><td>${money(g)}</td></tr>`;
            }).join("")}</tbody>
          </table></div>`;
      }

      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${isCaucion ? "Caución bursátil" : "Plazo fijo"}</h3>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(proj.amount)}</b></div>
            <div class="inv-kpi"><small>${isCaucion ? "TNA 1 día" : "Mejor TNA"}</small><b class="pos">${num(bestTna)}%</b></div>
            <div class="inv-kpi"><small>Ganás en ${days}d</small><b class="pos">${money(proj.interest)}</b></div>
            <div class="inv-kpi"><small>Total</small><b>${money(proj.final)}</b></div>
          </div>
          <div class="inv-break">
            <span>Liquidez <b>${data.liquidity || "—"}</b></span>
            <span>Riesgo <b>${data.risk || "bajo"}</b></span>
          </div>
        </div>
        ${listHtml}`;
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runLecap = async () => {
    const symbol = $("#inv-symbol").value;
    const amount = parseFloat($("#inv-amount").value);
    if (!symbol || !amount) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const r = await (await fetch(`/api/inversiones/lecap-simular?symbol=${encodeURIComponent(symbol)}&amount=${amount}`)).json();
      if (!r.ok) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ ${r.error || "No se pudo simular."}</div>`;
        return;
      }
      const retClass = r.total_return >= 0 ? "pos" : "neg";
      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${r.symbol} · Letra capitalizable</h3>
          <div class="bond-metrics">
            ${r.tna_pct != null ? `<div class="metric"><small>TNA</small><b class="pos">${num(r.tna_pct)}%</b></div>` : ""}
            ${r.tem_pct != null ? `<div class="metric"><small>TEM</small><b>${num(r.tem_pct)}%</b></div>` : ""}
            <div class="metric"><small>Precio</small><b>${num(r.price)}</b></div>
            <div class="metric"><small>Valor final</small><b>${num(r.valor_final)}</b></div>
          </div>
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(r.invested)}</b></div>
            <div class="inv-kpi"><small>Nominales</small><b>${new Intl.NumberFormat("es-AR").format(Math.round(r.nominales))}</b></div>
            <div class="inv-kpi"><small>Cobrás al vto</small><b>${money(r.total_to_collect)}</b></div>
            <div class="inv-kpi"><small>Ganancia</small><b class="${retClass}">${money(r.total_return)} · ${num(r.return_pct)}%</b></div>
          </div>
          <div class="inv-break">
            <span>Vencimiento en <b>${r.days} días</b></span>
            <span>${r.maturity_note}</span>
          </div>
        </div>`;
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runBond = async () => {
    const kind = $("#inv-kind").value;
    const symbol = $("#inv-symbol").value;
    const amount = parseFloat($("#inv-amount").value);
    const price = parseFloat($("#inv-price").value);
    if (!symbol || !amount || !price) return;
    $("#inv-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const res = await fetch(`/api/inversiones/simular?symbol=${encodeURIComponent(symbol)}&amount=${amount}&price=${price}&kind=${kind}`);
      const r = await res.json();
      if (!r.ok) {
        $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ ${r.error || "No se pudo simular."}</div>`;
        return;
      }
      const retClass = r.total_return >= 0 ? "pos" : "neg";
      // Traer métricas de mercado (TIR, duration, paridad) en paralelo
      let metricsHtml = "";
      try {
        const m = await (await fetch(`/api/inversiones/analizar?symbol=${encodeURIComponent(symbol)}&price=${price}&kind=${kind}`)).json();
        if (m.ok) {
          metricsHtml = `<div class="bond-metrics">
            ${m.tir_pct != null ? `<div class="metric"><small>TIR</small><b class="${m.tir_pct>=0?'pos':'neg'}">${num(m.tir_pct)}%</b></div>` : ""}
            ${m.tna_pct != null ? `<div class="metric"><small>TNA</small><b>${num(m.tna_pct)}%</b></div>` : ""}
            ${m.md != null ? `<div class="metric"><small>Duration mod.</small><b>${num(m.md)}</b></div>` : ""}
            ${m.paridad_pct != null ? `<div class="metric"><small>Paridad</small><b>${num(m.paridad_pct)}%</b></div>` : ""}
          </div>`;
        }
      } catch {}
      $("#inv-result").innerHTML = `
        <div class="inv-summary">
          <h3>${r.symbol} · ${r.name || ""}</h3>
          ${metricsHtml}
          <div class="inv-kpis">
            <div class="inv-kpi"><small>Invertís</small><b>${money(r.invested)}</b></div>
            <div class="inv-kpi"><small>Nominales</small><b>${new Intl.NumberFormat("es-AR").format(Math.round(r.nominales))}</b></div>
            <div class="inv-kpi"><small>Total a cobrar</small><b>${money(r.total_to_collect)}</b></div>
            <div class="inv-kpi"><small>Resultado</small><b class="${retClass}">${money(r.total_return)} · ${num(r.return_pct)}%</b></div>
          </div>
          <div class="inv-break">
            <span>Renta: <b>${money(r.total_interest)}</b></span>
            <span>Capital: <b>${money(r.total_principal)}</b></span>
            <span>${r.payments_count} pagos · próximo ${r.next_payment ? fmtDate(r.next_payment.date) : "—"}</span>
          </div>
        </div>
        <div class="inv-schedule">
          <h4>Cronograma de cobros</h4>
          <table class="inv-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Renta</th><th>Capital</th><th>Total</th></tr></thead>
            <tbody>${r.schedule.map((p) => `<tr>
              <td>${fmtDate(p.date)}</td>
              <td><span class="tag-${p.kind.includes("mort") ? "amort" : "coupon"}">${p.kind}</span></td>
              <td>${money(p.interest)}</td>
              <td>${money(p.principal)}</td>
              <td><b>${money(p.amount)}</b></td>
            </tr>`).join("")}</tbody>
          </table>
        </div>`;
    } catch {
      $("#inv-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };

  const runSim = () => {
    const kind = $("#inv-kind").value;
    if (kind === "fci") return runFci();
    if (kind === "caucion" || kind === "plazofijo") return runTasa(kind);
    if (kind === "lecap") return runLecap();
    return runBond();
  };

  $("#inv-kind").addEventListener("change", async () => {
    toggleControls();
    await loadSymbols();
  });
  $("#inv-sim-btn").addEventListener("click", runSim);
  // Simular FCI al abrir (es la opción por defecto)
  runFci();
}

const num = (v) => v == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v);

// ── Mercado de bonos (tableros + curvas + carry + variables) ──
const FAM_LABELS = {
  soberanos_ar: "Soberanos Ley Argentina",
  soberanos_ny: "Soberanos Ley NY",
  bopreal: "BOPREAL",
  lecaps: "LECAPs",
  boncaps: "BONCAPs",
};

function _mktTabs() {
  const tabs = [["tableros","📊 Cotizaciones"],["carry","📈 Carry"],["variables","🏦 Variables"]];
  const active = state.mktTab || "tableros";
  return `<div class="mkt-tabs">${tabs.map(([k,l]) =>
    `<button class="mkt-tab ${active===k?"active":""}" data-mtab="${k}">${l}</button>`).join("")}</div>`;
}

function _wireMktTabs() {
  document.querySelectorAll("[data-mtab]").forEach((b) => {
    b.onclick = () => { state.mktTab = b.dataset.mtab; renderMercado(); };
  });
}

function renderMercado() {
  const tab = state.mktTab || "tableros";
  if (tab === "carry") return renderMercadoCarry();
  if (tab === "variables") return renderMercadoVariables();
  return renderMercadoTableros();
}

async function renderMercadoTableros() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Cargando tableros de mercado…</div>`;
  _wireMktTabs();
  try {
    const data = await (await fetch("/api/inversiones/tableros")).json();
    if (!data.ok || !data.families) {
      $("#mkt-wrap").innerHTML = `${_mktTabs()}<div class="inv-placeholder">No se pudieron cargar los tableros. Requiere precios en vivo de BYMA (en el servidor).</div>`;
      _wireMktTabs();
      return;
    }
    const families = data.families;
    const curvePoints = [];
    ["soberanos_ar", "soberanos_ny"].forEach((fam) => {
      (families[fam] || []).forEach((b) => {
        if (b.tir_pct != null && b.md != null) {
          curvePoints.push({ ticker: b.ticker, tir: b.tir_pct, md: b.md, fam });
        }
      });
    });

    let html = _mktTabs() + `<div class="mkt-head">
      <div><div class="eyebrow">Mercado de bonos</div>
      <h2 class="inv-title">Curvas y métricas</h2>
      <p class="inv-sub">TIR, duration y paridad de cada bono, con precios en vivo de BYMA.</p></div>
    </div>`;

    if (curvePoints.length >= 2) {
      html += `<div class="chart-card"><div class="chart-head"><h2>Curva de rendimiento soberana</h2>
        <div class="chart-legend"><span class="lg" style="--c:#2563EB">Ley AR</span><span class="lg" style="--c:#0E7C6B">Ley NY</span></div></div>
        <div id="mkt-curve"></div></div>`;
    }

    const order = ["soberanos_ar", "soberanos_ny", "bopreal", "lecaps", "boncaps"];
    order.forEach((fam) => {
      const items = families[fam];
      if (!items || !items.length) return;
      const isSov = fam.startsWith("soberanos") || fam === "bopreal";
      html += `<div class="mkt-board">
        <h3>${FAM_LABELS[fam] || fam} <small>${items.length}</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr>
            <th>Bono</th><th>Precio</th>
            ${isSov ? "<th>TIR</th><th>MD</th><th>Paridad</th>" : "<th>TNA</th><th>TEM</th>"}
            <th>Vto</th><th>Días</th>
          </tr></thead>
          <tbody>${items.map((b) => `<tr>
            <td><b>${b.ticker}</b></td>
            <td>${b.price != null ? num(b.price) : "—"} <span class="ccy">${b.price_ccy || ""}</span></td>
            ${isSov
              ? `<td class="${(b.tir_pct||0)>=0?'pos':'neg'}">${b.tir_pct != null ? num(b.tir_pct)+"%" : "—"}</td>
                 <td>${b.md != null ? num(b.md) : "—"}</td>
                 <td>${b.paridad_pct != null ? num(b.paridad_pct)+"%" : "—"}</td>`
              : `<td>${b.tna_pct != null ? num(b.tna_pct)+"%" : "—"}</td>
                 <td>${b.tem_pct != null ? num(b.tem_pct)+"%" : "—"}</td>`}
            <td>${b.maturity || "—"}</td>
            <td>${b.days != null ? b.days : "—"}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
    });

    const fin = data.dolares_financieros;
    if (fin && (fin.al?.length || fin.gd?.length)) {
      const rows = [...(fin.al||[]), ...(fin.gd||[])].filter(x => x.mep || x.ccl);
      if (rows.length) {
        html += `<div class="mkt-board">
          <h3>Dólares financieros <small>por bono</small></h3>
          <table class="inv-table mkt-table">
            <thead><tr><th>Bono</th><th>MEP</th><th>CCL</th></tr></thead>
            <tbody>${rows.map((r) => `<tr><td><b>${r.ticker}</b></td>
              <td>${r.mep != null ? "$"+num(r.mep) : "—"}</td>
              <td>${r.ccl != null ? "$"+num(r.ccl) : "—"}</td></tr>`).join("")}</tbody>
          </table></div>`;
      }
    }

    wrap.innerHTML = html;
    _wireMktTabs();
    if (curvePoints.length >= 2) drawYieldCurve(curvePoints);
  } catch {
    $("#mkt-wrap").innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al cargar los tableros.</div>`;
    _wireMktTabs();
  }
}

async function renderMercadoCarry() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Calculando equilibrios de carry…</div>`;
  _wireMktTabs();
  try {
    const d = await (await fetch("/api/mercado/carry")).json();
    if (!d.ok || !(d.rows || []).length) {
      wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Sin datos de LECAPs/BONCAPs ahora (BYMA fuera de rueda o feed caído). Requiere precios en vivo en el servidor.</div>`;
      _wireMktTabs();
      return;
    }
    const dol = d.dolares || {};
    const dolKey = state.carryDol || "mep";
    const boncaps = d.rows.filter((r) => r.tipo === "BONCAP");
    const lecaps = d.rows.filter((r) => r.tipo === "LECAP");
    const bkClass = (v) => v == null ? "" : v >= 30 ? "bk-verde" : v >= 15 ? "bk-amarillo" : v >= 5 ? "bk-naranja" : "bk-rojo";

    const table = (rows, title) => rows.length ? `
      <div class="mkt-board"><h3>${title}</h3>
      <table class="inv-table mkt-table">
        <thead><tr><th>Ticker</th><th>Precio</th><th>Días</th>
          <th>MEP eq.</th><th>CCL eq.</th><th>Blue eq.</th><th>Breakeven anual</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td><b>${r.ticker}</b></td><td>${num(r.precio, 2)}</td><td>${r.dias}</td>
          <td class="hl">${r.eq_mep ? "$"+num(r.eq_mep, 0) : "—"}</td>
          <td>${r.eq_ccl ? "$"+num(r.eq_ccl, 0) : "—"}</td>
          <td>${r.eq_blue ? "$"+num(r.eq_blue, 0) : "—"}</td>
          <td class="${bkClass(r.breakeven_anual_pct)}">+${num(r.breakeven_anual_pct, 1)}%</td></tr>`).join("")}</tbody>
      </table></div>` : "";

    wrap.innerHTML = `${_mktTabs()}
      <div class="mkt-head"><div class="eyebrow">Carry trade en dólares</div>
        <h2 class="inv-title">Dólar de equilibrio</h2>
        <p class="inv-sub">El valor al que debería estar el dólar al vencimiento para que comprar la letra hoy equivalga a comprar dólares. Si el dólar queda por debajo del equilibrio, el carry fue rentable.</p></div>
      <div class="carry-dolares">${[["oficial","Oficial"],["mep","MEP"],["blue","Blue"],["ccl","CCL"]].map(([k,l]) =>
        `<div class="carry-dol"><small>${l}</small><b>${dol[k] ? "$"+num(dol[k], 2) : "—"}</b></div>`).join("")}</div>
      ${table(boncaps, "BONCAPs (Bonos Capitalizables)")}
      ${table(lecaps, "LECAPs (Letras Capitalizables)")}
      <p class="mkt-note"><b>Breakeven:</b> devaluación anual necesaria para empatar contra el dólar. <span class="bk-verde">Verde</span> = alto margen · <span class="bk-amarillo">Amarillo</span> = moderado · <span class="bk-naranja">Naranja</span> = poco · <span class="bk-rojo">Rojo</span> = perdés vs dólar. Fórmula: ${d.formula}.</p>`;
    _wireMktTabs();
  } catch {
    wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al calcular el carry.</div>`;
    _wireMktTabs();
  }
}

async function renderMercadoVariables() {
  const wrap = $("#mkt-wrap");
  wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">Consultando variables del BCRA…</div>`;
  _wireMktTabs();
  try {
    const d = await (await fetch("/api/mercado/variables")).json();
    const v = d.vars || {};
    const cotiz = d.cotizaciones || [];
    const fmt$ = (x) => x == null ? "—" : "$" + num(x, 2);

    let html = `${_mktTabs()}
      <div class="mkt-head"><div class="eyebrow">Variables de referencia</div>
        <h2 class="inv-title">Dólares y macro</h2>
        <p class="inv-sub">Cotizaciones con su brecha contra el mayorista, más inflación, CER y tasas del BCRA.</p></div>`;

    if (cotiz.length) {
      html += `<div class="mkt-board"><h3>Cotizaciones del dólar <small>brecha vs mayorista</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Tipo</th><th>Valor</th><th>Brecha</th></tr></thead>
          <tbody>${cotiz.map((c) => `<tr>
            <td><b>${c.nombre}</b></td><td>${fmt$(c.valor)}</td>
            <td class="${c.brecha == null ? "" : c.brecha >= 4 ? "neg" : "pos"}">${c.brecha == null ? "–" : "+"+num(c.brecha, 1)+"%"}</td>
          </tr>`).join("")}</tbody>
        </table></div>`;
    }

    const macroKeys = Object.keys(v);
    if (macroKeys.length) {
      html += `<div class="mkt-board"><h3>Variables macro <small>BCRA</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Variable</th><th>Valor</th><th>Fecha</th></tr></thead>
          <tbody>${macroKeys.map((k) => {
            const it = v[k] || {};
            const val = ["cer","mayorista"].includes(k) ? fmt$(it.valor) : (it.valor != null ? num(it.valor, 2) + (k.includes("tasa") || k.includes("inflacion") ? "%" : "") : "—");
            return `<tr><td><b>${it.label || k}</b><br><small style="color:var(--slate-2)">${it.desc || ""}</small></td>
              <td>${val}</td><td>${it.fecha || "—"}</td></tr>`;
          }).join("")}</tbody>
        </table></div>`;
    }

    const bandas = d.bandas || [];
    if (bandas.length) {
      html += `<div class="mkt-board"><h3>Bandas cambiarias <small>piso y techo</small></h3>
        <table class="inv-table mkt-table">
          <thead><tr><th>Mes</th><th>Piso</th><th>Techo</th></tr></thead>
          <tbody>${bandas.map((b) => `<tr><td>${(b.fecha||"").slice(0,7)}</td>
            <td>$${num(b.inferior, 0)}</td><td>$${num(b.superior, 0)}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }

    if (!cotiz.length && !macroKeys.length) {
      html += `<div class="inv-placeholder">Sin datos ahora. Requiere conexión al BCRA y BYMA en el servidor.</div>`;
    }
    wrap.innerHTML = html;
    _wireMktTabs();
  } catch {
    wrap.innerHTML = `${_mktTabs()}<div class="inv-placeholder">⚠️ Error al cargar las variables.</div>`;
    _wireMktTabs();
  }
}

function drawYieldCurve(points) {
  const W = 900, H = 320, P = { t: 20, r: 20, b: 44, l: 54 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const mds = points.map((p) => p.md), tirs = points.map((p) => p.tir);
  let xmin = Math.min(...mds), xmax = Math.max(...mds);
  let ymin = Math.min(...tirs), ymax = Math.max(...tirs);
  const xpad = (xmax - xmin) * 0.1 || 0.5, ypad = (ymax - ymin) * 0.15 || 1;
  xmin -= xpad; xmax += xpad; ymin -= ypad; ymax += ypad;
  const X = (v) => P.l + ((v - xmin) / (xmax - xmin)) * iw;
  const Y = (v) => P.t + ih - ((v - ymin) / (ymax - ymin)) * ih;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const yv = ymin + (i/4)*(ymax-ymin), yy = Y(yv).toFixed(1);
    grid += `<line class="grid-line" x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}"/>`;
    grid += `<text class="axis-label" x="${P.l-8}" y="${+yy+4}" text-anchor="end">${num(yv)}%</text>`;
    const xv = xmin + (i/4)*(xmax-xmin), xx = X(xv).toFixed(1);
    grid += `<text class="axis-label" x="${xx}" y="${H-16}" text-anchor="middle">${num(xv)}</text>`;
  }
  const dots = points.map((p) => {
    const color = p.fam === "soberanos_ar" ? "#2563EB" : "#0E7C6B";
    return `<g><circle cx="${X(p.md).toFixed(1)}" cy="${Y(p.tir).toFixed(1)}" r="5" fill="${color}"/>
      <text x="${X(p.md).toFixed(1)}" y="${(Y(p.tir)-9).toFixed(1)}" text-anchor="middle" class="curve-label">${p.ticker}</text></g>`;
  }).join("");

  $("#mkt-curve").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <text class="axis-title" x="${P.l+iw/2}" y="${H-2}" text-anchor="middle">Duration modificada (años)</text>
    ${dots}
  </svg>`;
}

// ── FCI con filtros ──────────────────────────────────────
async function renderFCI() {
  const wrap = $("#fci-wrap");
  if (!state.fciData) {
    wrap.innerHTML = `<div class="inv-placeholder">Cargando fondos money market…</div>`;
    try {
      state.fciData = await (await fetch("/api/fci/money-market")).json();
    } catch {
      wrap.innerHTML = `<div class="inv-placeholder">⚠️ No se pudieron cargar los fondos.</div>`;
      return;
    }
  }
  const data = state.fciData;
  const funds = data.funds || [];
  const managers = [...new Set(funds.map((f) => f.manager))].sort();
  const fq = state.fciQuery || "";
  const fmgr = state.fciManager || "";
  const fsort = state.fciSort || "tna-desc";
  const amount = state.result ? Math.round(state.result.summary.stable_surplus) : 100000;

  let filtered = funds.filter((f) => {
    if (fq && !f.name.toLowerCase().includes(fq.toLowerCase()) && !f.manager.toLowerCase().includes(fq.toLowerCase())) return false;
    if (fmgr && f.manager !== fmgr) return false;
    return true;
  });
  if (fsort === "tna-desc") filtered.sort((a, b) => b.tna - a.tna);
  else if (fsort === "tna-asc") filtered.sort((a, b) => a.tna - b.tna);
  else if (fsort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));

  const srcNote = data.source === "CAFCI"
    ? `Datos en vivo de CAFCI · ${data.live_count} fondos`
    : "Tasas de referencia — conectá CAFCI en el servidor para datos en vivo";

  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Fondos comunes de inversión</div>
      <h2 class="inv-title">FCI Money Market</h2>
      <p class="inv-sub">Rescate en el día (T+0), riesgo muy bajo. Filtrá y compará el rendimiento. ${srcNote}.</p></div>

    <div class="fci-filters">
      <input type="text" id="fci-search" placeholder="Buscar fondo o administradora…" value="${fq}">
      <select id="fci-mgr">
        <option value="">Todas las administradoras</option>
        ${managers.map((m) => `<option value="${m}" ${m===fmgr?"selected":""}>${m}</option>`).join("")}
      </select>
      <select id="fci-sort">
        <option value="tna-desc" ${fsort==="tna-desc"?"selected":""}>Mayor TNA</option>
        <option value="tna-asc" ${fsort==="tna-asc"?"selected":""}>Menor TNA</option>
        <option value="name" ${fsort==="name"?"selected":""}>Nombre A-Z</option>
      </select>
    </div>

    <div class="fci-count">${filtered.length} fondo${filtered.length!==1?"s":""} · simulando con ${money(amount)} a 30 días</div>

    <div class="fci-grid">
      ${filtered.map((f) => {
        const g30 = amount * (f.tna/100/365) * 30;
        return `<div class="fci-card">
          <div class="fci-card-head">
            <div><b>${f.name}</b><small>${f.manager}</small></div>
            <div class="fci-tna"><b>${num(f.tna)}%</b><small>TNA</small></div>
          </div>
          <div class="fci-card-body">
            <div><small>TEA</small><span>${num(f.tea)}%</span></div>
            <div><small>Liquidez</small><span>${f.liquidity}</span></div>
            <div><small>Riesgo</small><span>${f.risk}</span></div>
            <div><small>Ganás en 30d</small><span class="pos">${money(g30)}</span></div>
          </div>
        </div>`;
      }).join("")}
    </div>
    ${!filtered.length ? `<div class="inv-placeholder">No hay fondos con ese filtro.</div>` : ""}`;

  const search = $("#fci-search");
  if (search) {
    search.oninput = (e) => {
      state.fciQuery = e.target.value;
      renderFCI();
      setTimeout(() => { const el = $("#fci-search"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
    };
  }
  const mgr = $("#fci-mgr");
  if (mgr) mgr.onchange = (e) => { state.fciManager = e.target.value; renderFCI(); };
  const sort = $("#fci-sort");
  if (sort) sort.onchange = (e) => { state.fciSort = e.target.value; renderFCI(); };
}

// ── Impuestos ────────────────────────────────────────────
function renderImpuestos() {
  const wrap = $("#imp-wrap");
  if (!state.impOps) {
    // Operaciones de ejemplo
    state.impOps = [
      { fecha: monthDay(5), tipo: "venta", neto: 2000000, medio: "banco" },
      { fecha: monthDay(8), tipo: "venta", neto: 800000, medio: "efectivo" },
      { fecha: monthDay(12), tipo: "compra", neto: 1200000, medio: "banco" },
    ];
  }
  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Proyección impositiva</div>
      <h2 class="inv-title">Impuestos a pagar</h2>
      <p class="inv-sub">Cargá tus ventas y compras y estimá IVA, IIBB, Ganancias e impuesto al cheque. Los vencimientos se pueden llevar al flujo de caja.</p></div>

    <div class="imp-board">
      <aside class="imp-controls ctrl-card">
        <div class="ctrl-head"><h2>Operaciones</h2><button class="add-btn" id="imp-add">+ Agregar</button></div>
        <div class="imp-ops" id="imp-ops"></div>
        <div class="imp-params">
          <label class="field"><span>Ganancias del último ejercicio ($)</span>
            <div class="money-input"><em>$</em><input type="number" id="imp-gan" value="${state.impGan || 3000000}" step="100000"></div>
            <small>Para estimar los anticipos.</small>
          </label>
        </div>
        <button class="btn-primary" id="imp-calc">Calcular impuestos</button>
      </aside>
      <div class="imp-result" id="imp-result"><div class="inv-placeholder">Cargá tus operaciones y calculá.</div></div>
    </div>`;

  const renderOps = () => {
    $("#imp-ops").innerHTML = state.impOps.map((op, i) => `
      <div class="imp-op-row" data-i="${i}">
        <select class="imp-tipo">
          <option value="venta" ${op.tipo==="venta"?"selected":""}>Venta</option>
          <option value="compra" ${op.tipo==="compra"?"selected":""}>Compra</option>
        </select>
        <div class="money-input"><em>$</em><input type="number" class="imp-neto" value="${op.neto}" step="10000" placeholder="Neto"></div>
        <input type="date" class="imp-fecha" value="${op.fecha}">
        <select class="imp-medio">
          <option value="banco" ${op.medio==="banco"?"selected":""}>Banco</option>
          <option value="efectivo" ${op.medio==="efectivo"?"selected":""}>Efectivo</option>
        </select>
        <button class="imp-del" data-i="${i}">×</button>
      </div>`).join("");
    // Wire
    $$(".imp-op-row").forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector(".imp-tipo").onchange = (e) => { state.impOps[i].tipo = e.target.value; };
      row.querySelector(".imp-neto").oninput = (e) => { state.impOps[i].neto = parseFloat(e.target.value) || 0; };
      row.querySelector(".imp-fecha").onchange = (e) => { state.impOps[i].fecha = e.target.value; };
      row.querySelector(".imp-medio").onchange = (e) => { state.impOps[i].medio = e.target.value; };
      row.querySelector(".imp-del").onclick = () => { state.impOps.splice(i, 1); renderOps(); };
    });
  };
  renderOps();

  $("#imp-add").onclick = () => {
    state.impOps.push({ fecha: monthDay(15), tipo: "venta", neto: 500000, medio: "banco" });
    renderOps();
  };

  const calc = async () => {
    state.impGan = parseFloat($("#imp-gan").value) || 0;
    $("#imp-result").innerHTML = `<div class="inv-placeholder">Calculando…</div>`;
    try {
      const r = await (await fetch("/api/impuestos/estimar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operaciones: state.impOps, ganancias_impuesto_anual: state.impGan }),
      })).json();
      if (!r.ok) { $("#imp-result").innerHTML = `<div class="inv-placeholder">⚠️ Error.</div>`; return; }
      state.impResult = r;
      const s = r.resumen, e = r.efectivo_vs_banco;
      $("#imp-result").innerHTML = `
        <div class="imp-kpis">
          <div class="imp-kpi hero"><small>Carga impositiva estimada</small><b>${money(s.carga_total_estimada)}</b><span>IVA + IIBB + imp. cheque</span></div>
          <div class="imp-kpi"><small>IVA a pagar</small><b>${money(s.total_iva)}</b></div>
          <div class="imp-kpi"><small>IIBB</small><b>${money(s.total_iibb)}</b></div>
          <div class="imp-kpi"><small>Impuesto al cheque</small><b>${money(s.impuesto_cheque)}</b></div>
          <div class="imp-kpi"><small>Anticipo Ganancias / mes</small><b>${money(s.anticipo_ganancias_mensual)}</b></div>
        </div>

        <div class="imp-cash card">
          <h3>Efectivo vs Banco</h3>
          <div class="imp-bar">
            <div class="imp-bar-fill" style="width:${e.pct_efectivo}%"></div>
          </div>
          <div class="imp-bar-labels">
            <span><b>${money(e.ventas_efectivo)}</b> en efectivo (${num(e.pct_efectivo)}%)</span>
            <span><b>${money(e.ventas_banco)}</b> bancarizado</span>
          </div>
          <p class="imp-note">${e.nota}</p>
        </div>

        <div class="imp-vtos card">
          <div class="imp-vtos-head">
            <h3>Vencimientos proyectados</h3>
            <button class="btn-primary sm" id="imp-to-cashflow">Llevar al flujo de caja →</button>
          </div>
          <table class="inv-table">
            <thead><tr><th>Vencimiento</th><th>Impuesto</th><th>Monto</th></tr></thead>
            <tbody>${r.vencimientos.map((v) => `<tr>
              <td>${fmtDate(v.fecha)}</td><td>${v.concepto}</td>
              <td class="neg">${money(v.monto)}</td></tr>`).join("")}</tbody>
          </table>
          <p class="imp-disclaimer">${r.disclaimer}</p>
        </div>`;

      $("#imp-to-cashflow").onclick = () => {
        // Agregar los vencimientos impositivos como movimientos del cash flow
        r.vencimientos.forEach((v) => addMovement({
          label: v.concepto, value: v.monto, date: v.fecha, recurrence: "none",
        }));
        project();
        switchView("flujo");
      };
    } catch {
      $("#imp-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al calcular.</div>`;
    }
  };
  $("#imp-calc").onclick = calc;
  if (state.impResult) calc();
}

// ── Conciliación bancaria ────────────────────────────────
function renderConciliacion() {
  const wrap = $("#conc-wrap");
  const hasMovs = state.result && readMovements().length > 0;
  wrap.innerHTML = `
    <div class="mkt-head"><div class="eyebrow">Conciliación bancaria</div>
      <h2 class="inv-title">Extracto vs proyección</h2>
      <p class="inv-sub">Subí el extracto de tu banco y lo comparamos contra lo que proyectaste en el flujo de caja. Detecta desvíos, faltantes y movimientos no previstos.</p></div>

    <div class="conc-upload card">
      <div class="conc-upload-inner">
        <div>
          <h3>1. Subí el extracto del banco</h3>
          <p>Excel o CSV. Detecta las columnas automáticamente, sea cual sea el banco.</p>
        </div>
        <input type="file" id="conc-file" accept=".xlsx,.xls,.csv" style="display:none">
        <button class="btn-primary" id="conc-upload-btn" style="width:auto">↑ Subir extracto</button>
      </div>
      ${!hasMovs ? `<p class="conc-warn">⚠️ Primero cargá tus movimientos en Flujo de caja para poder comparar.</p>` : ""}
    </div>

    <div id="conc-result"></div>`;

  $("#conc-upload-btn").onclick = () => $("#conc-file").click();
  $("#conc-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#conc-upload-btn");
    btn.textContent = "Procesando…";
    try {
      // 1. Parsear el extracto
      const fd = new FormData();
      fd.append("file", file);
      const imp = await (await fetch("/api/conciliacion/importar", { method: "POST", body: fd })).json();
      if (!imp.ok) { alert(imp.error || "No se pudo leer el extracto."); return; }

      // 2. Conciliar contra los movimientos proyectados (expandidos)
      const proyectados = expandMovementsForConc();
      const r = await (await fetch("/api/conciliacion/conciliar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proyectados, extracto: imp.movements }),
      })).json();
      renderConcResult(r, imp.count);
    } catch {
      alert("Error al procesar el extracto.");
    } finally {
      btn.textContent = "↑ Subir extracto";
      e.target.value = "";
    }
  };
}

// Expande los movimientos del cash flow a fechas concretas para conciliar
function expandMovementsForConc() {
  const movs = readMovements();
  const out = [];
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 90);
  movs.forEach((m) => {
    const base = new Date(m.date + "T00:00:00");
    if (m.recurrence === "none") {
      out.push({ date: m.date, amount: m.amount, label: m.label });
    } else {
      let d = new Date(base);
      let guard = 0;
      while (d <= end && guard < 200) {
        if (d >= start) out.push({ date: d.toISOString().slice(0, 10), amount: m.amount, label: m.label });
        if (m.recurrence === "weekly") d.setDate(d.getDate() + 7);
        else if (m.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
        else break;
        guard++;
      }
    }
  });
  return out;
}

function renderConcResult(r, extractoCount) {
  if (!r.ok) { $("#conc-result").innerHTML = `<div class="inv-placeholder">⚠️ Error al conciliar.</div>`; return; }
  const s = r.resumen;
  const money2 = (v) => (v >= 0 ? "+" : "−") + money(Math.abs(v));

  const section = (title, items, cols, cls) => {
    if (!items.length) return "";
    return `<div class="conc-section card ${cls}">
      <h3>${title} <span class="conc-badge">${items.length}</span></h3>
      <table class="inv-table">
        <thead><tr>${cols.map((c) => `<th>${c.h}</th>`).join("")}</tr></thead>
        <tbody>${items.map((it) => `<tr>${cols.map((c) => `<td class="${c.cls ? c.cls(it) : ''}">${c.f(it)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
  };

  $("#conc-result").innerHTML = `
    <div class="conc-kpis">
      <div class="conc-kpi"><b>${s.tasa_conciliacion}%</b><small>conciliado</small></div>
      <div class="conc-kpi good"><b>${s.conciliados}</b><small>coinciden</small></div>
      <div class="conc-kpi warn"><b>${s.desvios}</b><small>con desvío</small></div>
      <div class="conc-kpi bad"><b>${s.faltantes}</b><small>faltantes</small></div>
      <div class="conc-kpi"><b>${s.sorpresas}</b><small>no previstos</small></div>
    </div>

    ${section("Con desvío de monto o fecha", r.desvios, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Esperabas", f: (x) => money(x.monto_proyectado) },
      { h: "Real", f: (x) => money(x.monto_real) },
      { h: "Diferencia", f: (x) => money2(x.diferencia), cls: (x) => x.diferencia < 0 ? "neg" : "in" },
      { h: "Días", f: (x) => x.dias_desvio },
    ], "warn")}

    ${section("Faltantes — proyectado que no apareció", r.faltantes, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Fecha", f: (x) => fmtDate(x.fecha) },
      { h: "Monto", f: (x) => money(x.monto), cls: () => "muted" },
    ], "bad")}

    ${section("No previstos — en el banco, sin proyectar", r.sorpresas, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Fecha", f: (x) => fmtDate(x.fecha) },
      { h: "Monto", f: (x) => money2(x.monto), cls: (x) => x.monto < 0 ? "neg" : "in" },
    ], "")}

    ${section("Conciliados correctamente", r.conciliados, [
      { h: "Concepto", f: (x) => x.label },
      { h: "Monto", f: (x) => money(x.monto_real) },
      { h: "Fecha real", f: (x) => fmtDate(x.fecha_real) },
    ], "good")}`;
}

// ── Navegación ───────────────────────────────────────────
function switchView(view) {
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  if (view === "inversiones") renderInversiones();
  if (view === "mercado") renderMercado();
  if (view === "fci") renderFCI();
  if (view === "impuestos") renderImpuestos();
  if (view === "conciliacion") renderConciliacion();
}

// ── Init ─────────────────────────────────────────────────
function init() {
  // Movimientos de ejemplo (una PyME típica)
  const demo = [
    { label: "Cobranzas de clientes", value: 500000, date: monthDay(25), recurrence: "monthly" },
    { label: "Sueldos", value: -350000, date: monthDay(28), recurrence: "monthly" },
    { label: "Alquiler", value: -120000, date: monthDay(10), recurrence: "monthly" },
    { label: "Pago a proveedor", value: -80000, date: addDays(15), recurrence: "none" },
  ];
  demo.forEach(addMovement);

  $("#add-mov").addEventListener("click", () => { addMovement(); });

  // Importar desde Excel/CSV
  $("#import-mov").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#import-mov");
    const orig = btn.textContent;
    btn.textContent = "Importando…";
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cashflow/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "No se pudo importar el archivo.");
        return;
      }
      // Limpiar movimientos actuales y cargar los importados
      $("#mov-list").innerHTML = "";
      data.movements.forEach((m) => addMovement({
        label: m.label,
        value: m.amount,
        date: m.date,
        recurrence: m.recurrence || "none",
      }));
      project();
      const skipped = data.skipped ? ` (${data.skipped} filas sin datos válidos se omitieron)` : "";
      alert(`Se importaron ${data.count} movimientos${skipped}.`);
    } catch {
      alert("Error al importar el archivo.");
    } finally {
      btn.textContent = orig;
      e.target.value = "";
    }
  });
  ["#opening", "#buffer", "#horizon"].forEach((sel) =>
    $(sel).addEventListener("input", project)
  );
  $$(".nav-item").forEach((n) =>
    n.addEventListener("click", () => { if (!n.disabled) switchView(n.dataset.view); })
  );

  // Toggle día / semana en la tabla
  $$(".vt-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.cfGrain = b.dataset.cfgrain;
      $$(".vt-btn").forEach((x) => x.classList.toggle("active", x.dataset.cfgrain === state.cfGrain));
      renderCashflowTable();
    })
  );

  project();
}

function monthDay(day) {
  const d = new Date();
  d.setDate(day);
  if (d < new Date()) d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

init();
