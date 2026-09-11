// reportes.js — Exportación de reportes a Excel y PDF con estilo de marca.
// Colores: navy #0B1F3A (títulos/resultados), teal #2DD4BF (subsecciones),
// gris #F2F2F2 (subtotales). Formato moneda $#,##0.

const RPT_NAVY = "0B1F3A", RPT_TEAL = "2DD4BF", RPT_GREY = "F2F2F2";
const MONEY_FMT = '$#,##0;($#,##0);\\-';

function _emp() { return (typeof state !== "undefined" && state.empresa) ? state.empresa : { nombre: "Mi Empresa" }; }
function _hoyTxt() { return new Date().toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" }); }

// ── Encabezado reutilizable para PDF (logo + empresa + fecha) ────
function agregarEncabezadoPDF(doc, empresa) {
  empresa = empresa || _emp();
  let x = 40, y = 40, textX = 40;
  if (empresa.logo) {
    try {
      doc.addImage(empresa.logo, "PNG", 40, 28, 90, 36);
      textX = 145;
    } catch (e) { /* logo inválido, seguir sin él */ }
  }
  doc.setTextColor(11, 31, 58);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(empresa.nombre || "Mi Empresa", textX, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  let sub = [];
  if (empresa.cuit) sub.push("CUIT " + empresa.cuit);
  sub.push("Generado el " + _hoyTxt());
  doc.text(sub.join("  ·  "), textX, 60);
  doc.setDrawColor(45, 212, 191); doc.setLineWidth(1.5);
  doc.line(40, 70, 555, 70);
  return 88; // Y donde puede empezar el contenido
}

// ── Helpers Excel (ExcelJS con estilos de marca) ────────────────
const XLS_NAVY = "FF0B1F3A", XLS_TEAL = "FF2DD4BF", XLS_GREY = "FFF2F2F2", XLS_WHITE = "FFFFFFFF";
const XLS_MONEY = '"$"#,##0;("$"#,##0)';

// Estilos reutilizables (tipos de fila)
function _xlsTitle(cell) {
  cell.font = { bold: true, color: { argb: XLS_WHITE }, size: 14, name: "Calibri" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_NAVY } };
  cell.alignment = { vertical: "middle" };
}
function _xlsHeader(cell) {
  cell.font = { bold: true, color: { argb: XLS_WHITE }, size: 10 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_NAVY } };
  cell.alignment = { vertical: "middle" };
  cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
}
function _xlsSection(cell) { // subsección teal
  cell.font = { bold: true, color: { argb: XLS_NAVY }, size: 10 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_TEAL } };
}
function _xlsSubtotal(cell) { // total gris
  cell.font = { bold: true, color: { argb: "FF000000" }, size: 10 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_GREY } };
}
function _xlsResult(cell) { // resultado clave navy
  cell.font = { bold: true, color: { argb: XLS_WHITE }, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_NAVY } };
}

// Agrega el encabezado de empresa a una hoja ExcelJS. Devuelve la fila siguiente.
async function _xlsEncabezado(ws, wb, titulo, subtitulo) {
  const emp = _emp();
  let row = 1;
  // Logo si existe
  if (emp.logo) {
    try {
      const imgId = wb.addImage({ base64: emp.logo, extension: "png" });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 48 } });
      ws.getRow(1).height = 40;
    } catch (e) {}
  }
  const rEmp = ws.getRow(1); rEmp.getCell(emp.logo ? 3 : 1).value = emp.nombre || "Mi Empresa";
  rEmp.getCell(emp.logo ? 3 : 1).font = { bold: true, size: 14, color: { argb: XLS_NAVY } };
  const rSub = ws.getRow(2);
  rSub.getCell(1).value = `${titulo}  ·  Generado el ${_hoyTxt()}${emp.cuit ? "  ·  CUIT "+emp.cuit : ""}`;
  rSub.getCell(1).font = { size: 9, color: { argb: "FF787878" }, italic: true };
  if (subtitulo) { ws.getRow(3).getCell(1).value = subtitulo; ws.getRow(3).getCell(1).font = { size: 9, color: { argb: "FF787878" } }; row = 4; }
  else row = 3;
  return row + 1; // deja una fila en blanco
}

async function _xlsSave(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function _saveXlsx(wb, filename) { XLSX.writeFile(wb, filename); }

function _money(n) { return (typeof money === "function") ? money(n) : "$" + Math.round(n).toLocaleString("es-AR"); }
function _short(iso) { return (typeof fmtDateShort === "function" && iso) ? fmtDateShort(iso) : (iso || "—"); }

// ════════════════════════════════════════════════════════════════
// 1. FLUJO DE CAJA
// ════════════════════════════════════════════════════════════════
function _flujoDatos() {
  // Reusa la lógica de grilla: categorías por período. Simplificado a
  // ingresos/egresos por categoría en el rango activo (state.cf*).
  const from = state.cfFrom, to = state.cfTo;
  const cuentaFiltro = state.cfAccount || "";
  const ccy = state.cfCurrency || "ARS";
  // Movimientos del rango, moneda y cuenta
  const movs = (state.movements || []).filter(m => {
    if (!m.amount || !m.date) return false;
    if (m.date < from || m.date > to) return false;
    if (cuentaFiltro && m.account !== cuentaFiltro) return false;
    if (typeof movCurrency === "function" && movCurrency(m) !== ccy) return false;
    return true;
  });
  // Agrupar por categoría
  const ingresos = {}, egresos = {};
  movs.forEach(m => {
    const cat = (typeof movCategoria === "function" ? movCategoria(m) : null) || (m.amount > 0 ? "otros_ingresos" : "otros_egresos");
    const lbl = (typeof catLabel === "function" ? catLabel(cat) : cat);
    if (m.amount > 0) ingresos[lbl] = (ingresos[lbl]||0) + m.amount;
    else egresos[lbl] = (egresos[lbl]||0) + Math.abs(m.amount);
  });
  return { from, to, ccy, cuentaFiltro, ingresos, egresos };
}

async function exportarFlujoExcel() {
  const d = _flujoDatos();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Flujo de Caja");
  ws.columns = [{ width: 40 }, { width: 18 }];
  let r = await _xlsEncabezado(ws, wb, "Flujo de Caja (resumen)",
    `Cuenta: ${d.cuentaFiltro?accountName(d.cuentaFiltro):"Todas (consolidado)"}  ·  Moneda: ${d.ccy}  ·  ${_short(d.from)} a ${_short(d.to)}`);
  // Título de tabla
  const hdr = ws.getRow(r); hdr.getCell(1).value = "Categoría"; hdr.getCell(2).value = "Monto";
  _xlsHeader(hdr.getCell(1)); _xlsHeader(hdr.getCell(2)); r++;
  const setMoney = (cell, v) => { cell.value = v; cell.numFmt = XLS_MONEY; cell.alignment = { horizontal: "right" }; };
  // Ingresos
  let rowSec = ws.getRow(r); rowSec.getCell(1).value = "INGRESOS"; _xlsSection(rowSec.getCell(1)); _xlsSection(rowSec.getCell(2)); r++;
  let tIng = 0;
  Object.keys(d.ingresos).forEach(k => { const row = ws.getRow(r); row.getCell(1).value = k; setMoney(row.getCell(2), d.ingresos[k]); tIng += d.ingresos[k]; r++; });
  let rowSub = ws.getRow(r); rowSub.getCell(1).value = "Subtotal Ingresos"; _xlsSubtotal(rowSub.getCell(1)); setMoney(rowSub.getCell(2), tIng); _xlsSubtotal(rowSub.getCell(2)); r++;
  // Egresos
  rowSec = ws.getRow(r); rowSec.getCell(1).value = "EGRESOS"; _xlsSection(rowSec.getCell(1)); _xlsSection(rowSec.getCell(2)); r++;
  let tEgr = 0;
  Object.keys(d.egresos).forEach(k => { const row = ws.getRow(r); row.getCell(1).value = k; setMoney(row.getCell(2), d.egresos[k]); tEgr += d.egresos[k]; r++; });
  rowSub = ws.getRow(r); rowSub.getCell(1).value = "Subtotal Egresos"; _xlsSubtotal(rowSub.getCell(1)); setMoney(rowSub.getCell(2), tEgr); _xlsSubtotal(rowSub.getCell(2)); r++;
  // Flujo neto
  const rowRes = ws.getRow(r); rowRes.getCell(1).value = "FLUJO NETO"; _xlsResult(rowRes.getCell(1)); setMoney(rowRes.getCell(2), tIng - tEgr); _xlsResult(rowRes.getCell(2));
  await _xlsSave(wb, `Flujo_de_Caja_${_short(d.from)}_${_short(d.to)}.xlsx`.replace(/[\/\s]/g,"-"));
}

function exportarFlujoPDF() {
  const d = _flujoDatos();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Flujo de Caja (resumen)", 40, y); y += 16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Cuenta: ${d.cuentaFiltro?accountName(d.cuentaFiltro):"Todas (consolidado)"}  ·  Moneda: ${d.ccy}  ·  ${_short(d.from)} a ${_short(d.to)}`, 40, y); y += 10;

  const body = [];
  body.push([{ content: "INGRESOS", colSpan: 2, styles: { fillColor: [45,212,191], textColor: [11,31,58], fontStyle: "bold" } }]);
  let tIng = 0;
  Object.keys(d.ingresos).forEach(k => { body.push([k, _money(d.ingresos[k])]); tIng += d.ingresos[k]; });
  body.push([{ content: "Subtotal Ingresos", styles: { fillColor: [242,242,242], fontStyle: "bold" } }, { content: _money(tIng), styles: { fillColor: [242,242,242], fontStyle: "bold" } }]);
  body.push([{ content: "EGRESOS", colSpan: 2, styles: { fillColor: [45,212,191], textColor: [11,31,58], fontStyle: "bold" } }]);
  let tEgr = 0;
  Object.keys(d.egresos).forEach(k => { body.push([k, _money(d.egresos[k])]); tEgr += d.egresos[k]; });
  body.push([{ content: "Subtotal Egresos", styles: { fillColor: [242,242,242], fontStyle: "bold" } }, { content: _money(tEgr), styles: { fillColor: [242,242,242], fontStyle: "bold" } }]);
  body.push([{ content: "FLUJO NETO", styles: { fillColor: [11,31,58], textColor: [255,255,255], fontStyle: "bold" } }, { content: _money(tIng - tEgr), styles: { fillColor: [11,31,58], textColor: [255,255,255], fontStyle: "bold" } }]);

  doc.autoTable({
    startY: y + 6, head: [["Categoría", "Monto"]], body,
    theme: "grid", headStyles: { fillColor: [11,31,58], textColor: [255,255,255] },
    columnStyles: { 1: { halign: "right" } }, styles: { fontSize: 9 },
  });
  doc.save(`Flujo_de_Caja_${_short(d.from)}_${_short(d.to)}.pdf`.replace(/[\/\s]/g,"-"));
}

// ════════════════════════════════════════════════════════════════
// 2. RENDIMIENTO DEL EXCEDENTE
// ════════════════════════════════════════════════════════════════
async function exportarRendimientoExcel(detalle, label, to) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rendimiento Excedente");
  ws.columns = [{width:18},{width:26},{width:16},{width:11},{width:16},{width:12},{width:20}];
  let r = await _xlsEncabezado(ws, wb, "Rendimiento del Excedente Invertido", `Periodo: ${label}  ·  Moneda: ARS`);
  const setMoney = (cell, v) => { cell.value = v; cell.numFmt = XLS_MONEY; cell.alignment = { horizontal: "right" }; };
  // KPI
  const total = detalle.reduce((s,x)=>s+x.rend,0);
  const kpiRow = ws.getRow(r);
  kpiRow.getCell(1).value = "TOTAL GENERADO POR EL EXCEDENTE INVERTIDO";
  ws.mergeCells(r,1,r,6);
  kpiRow.getCell(1).font = { bold:true, color:{argb:XLS_WHITE}, size:11 };
  kpiRow.getCell(1).fill = { type:"pattern", pattern:"solid", fgColor:{argb:XLS_NAVY} };
  const kpiVal = kpiRow.getCell(7); setMoney(kpiVal, total);
  kpiVal.font = { bold:true, color:{argb:"FF4ADE80"}, size:12 };
  kpiVal.fill = { type:"pattern", pattern:"solid", fgColor:{argb:XLS_NAVY} };
  r += 2;
  // Header tabla
  const hdrs = ["Tipo","Instrumento","Monto colocado","TNA %","Fecha colocación","Estado","Rendimiento"];
  const hr = ws.getRow(r); hdrs.forEach((h,i)=>{ hr.getCell(i+1).value = h; _xlsHeader(hr.getCell(i+1)); }); r++;
  detalle.forEach(x => {
    const row = ws.getRow(r);
    row.getCell(1).value = (typeof tipoInvLabel==="function"?tipoInvLabel(x.inv.tipo):x.inv.tipo);
    row.getCell(2).value = x.inv.label||"";
    setMoney(row.getCell(3), x.inv.monto||0);
    row.getCell(4).value = x.inv.rendimiento ? x.inv.rendimiento/100 : 0; row.getCell(4).numFmt = "0.0%";
    row.getCell(5).value = x.inv.fechaColocacion||"";
    row.getCell(6).value = x.inv.estado||"";
    setMoney(row.getCell(7), x.rend);
    r++;
  });
  // Total
  const tr = ws.getRow(r); tr.getCell(1).value = "TOTAL"; ws.mergeCells(r,1,r,6);
  _xlsResult(tr.getCell(1)); setMoney(tr.getCell(7), total); _xlsResult(tr.getCell(7)); r += 2;
  ws.getRow(r).getCell(1).value = "Rendimiento devengado = Monto × Tasa × Días/365 (interés simple, sin comisiones ni impuestos)."; r++;
  const nota = ws.getRow(r).getCell(1); nota.value = "Este es dinero que, sin colocarlo, habría quedado parado en la cuenta sin generar nada.";
  nota.font = { italic:true, bold:true, color:{argb:"FF2E7D32"} };
  await _xlsSave(wb, `Rendimiento_Excedente_${(label||"").replace(/\s+/g,"_")}.xlsx`);
}

function exportarRendimientoPDF(detalle, label, to) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Rendimiento del Excedente Invertido", 40, y); y += 16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Moneda: ARS`, 40, y); y += 14;

  const total = detalle.reduce((s,x)=>s+x.rend,0);
  // KPI destacado
  doc.setFillColor(11,31,58); doc.rect(40, y, 515, 52, "F");
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  doc.text("TOTAL GENERADO POR EL EXCEDENTE INVERTIDO", 54, y+18);
  doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.setTextColor(74,222,128);
  doc.text(_money(total), 54, y+42);
  y += 68;

  const body = detalle.map(x => [
    (typeof tipoInvLabel==="function"?tipoInvLabel(x.inv.tipo):x.inv.tipo),
    x.inv.label||"", _money(x.inv.monto),
    x.inv.rendimiento?x.inv.rendimiento+"%":"—",
    _short(x.inv.fechaColocacion), x.inv.estado||"", _money(x.rend),
  ]);
  body.push([{content:"TOTAL",colSpan:6,styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(total),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  doc.autoTable({
    startY: y, head: [["Tipo","Instrumento","Monto","TNA","Colocación","Estado","Rendimiento"]],
    body, theme:"grid", headStyles:{fillColor:[11,31,58],textColor:[255,255,255]},
    columnStyles:{2:{halign:"right"},6:{halign:"right"}}, styles:{fontSize:8},
  });
  let fy = doc.lastAutoTable.finalY + 16;
  doc.setFontSize(8); doc.setTextColor(90,90,90);
  doc.text("Rendimiento devengado = Monto x Tasa x Dias/365 (interés simple, sin comisiones/impuestos).", 40, fy);
  doc.setTextColor(46,125,50); doc.setFont("helvetica","bold");
  doc.text("Este es dinero que, sin colocarlo, habría quedado parado en la cuenta sin generar nada.", 40, fy+14);
  doc.save(`Rendimiento_Excedente_${(label||"").replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 3. ESTADO DE RESULTADOS
// ════════════════════════════════════════════════════════════════
async function exportarEstadoResultadosXlsx(acum, label) {
  const grupos = { ingresos: [], costos: [], gastos: [], impuestos: [], financieros: [] };
  Object.values(acum).forEach(r => { if (grupos[r.grupo]) grupos[r.grupo].push(r); });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Estado de Resultados");
  ws.columns = [{width:40},{width:18}];
  let r = await _xlsEncabezado(ws, wb, "Estado de Resultados (por devengado)", `Periodo: ${label}  ·  Criterio: devengado (fecha de emisión)`);
  const setMoney = (cell, v) => { cell.value = v; cell.numFmt = XLS_MONEY; cell.alignment = { horizontal: "right" }; };
  const hr = ws.getRow(r); hr.getCell(1).value = "Categoría"; hr.getCell(2).value = "Monto"; _xlsHeader(hr.getCell(1)); _xlsHeader(hr.getCell(2)); r++;
  const sec = (txt) => { const row = ws.getRow(r); row.getCell(1).value = txt; _xlsSection(row.getCell(1)); _xlsSection(row.getCell(2)); r++; };
  const item = (txt,v) => { const row = ws.getRow(r); row.getCell(1).value = txt; setMoney(row.getCell(2), v); r++; };
  const tot = (txt,v) => { const row = ws.getRow(r); row.getCell(1).value = txt; _xlsSubtotal(row.getCell(1)); setMoney(row.getCell(2), v); _xlsSubtotal(row.getCell(2)); r++; };
  const res = (txt,v) => { const row = ws.getRow(r); row.getCell(1).value = txt; _xlsResult(row.getCell(1)); setMoney(row.getCell(2), v); _xlsResult(row.getCell(2)); r++; };
  let tIng=0,tCos=0,tGas=0,tImp=0,tFin=0;
  sec("INGRESOS"); grupos.ingresos.forEach(x=>{const v=Math.abs(x.monto); item(x.rubro,v); tIng+=v;}); tot("Total INGRESOS",tIng);
  if(grupos.costos.length){ sec("COSTOS (directos)"); grupos.costos.forEach(x=>{const v=Math.abs(x.monto); item(x.rubro,v); tCos+=v;}); tot("Total Costos",tCos); }
  res("RESULTADO BRUTO", tIng-tCos);
  sec("GASTOS (administración)"); grupos.gastos.forEach(x=>{const v=Math.abs(x.monto); item(x.rubro,v); tGas+=v;}); tot("Total Gastos",tGas);
  res("RESULTADO OPERATIVO", tIng-tCos-tGas);
  if(grupos.impuestos.length){ sec("IMPUESTOS"); grupos.impuestos.forEach(x=>{const v=Math.abs(x.monto); item(x.rubro,v); tImp+=v;}); tot("Total IMPUESTOS",tImp); }
  if(grupos.financieros.length){ sec("FINANCIEROS"); grupos.financieros.forEach(x=>{const v=Math.abs(x.monto); item(x.rubro,v); tFin+=v;}); tot("Total FINANCIEROS",tFin); }
  res("RESULTADO NETO", tIng-tCos-tGas-tImp-tFin);
  r++;
  const nota = ws.getRow(r).getCell(1); nota.value = "Devengado = se imputa a la fecha de emisión del comprobante, no a la de cobro/pago (a diferencia del Flujo de Caja).";
  nota.font = { italic:true, size:9, color:{argb:"FF787878"} };
  await _xlsSave(wb, `Estado_de_Resultados_${label.replace(/\s+/g,"_")}.xlsx`);
}

function exportarEstadoResultadosPdf(acum, label) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Estado de Resultados (por devengado)", 40, y); y+=16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Criterio: devengado`, 40, y); y+=8;

  const grupos = { ingresos:[], costos:[], gastos:[], impuestos:[], financieros:[] };
  Object.values(acum).forEach(r => { if (grupos[r.grupo]) grupos[r.grupo].push(r); });
  const body = [];
  const sub = (txt) => body.push([{content:txt,colSpan:2,styles:{fillColor:[45,212,191],textColor:[11,31,58],fontStyle:"bold"}}]);
  const tot = (txt,v) => body.push([{content:txt,styles:{fillColor:[242,242,242],fontStyle:"bold"}},{content:_money(v),styles:{fillColor:[242,242,242],fontStyle:"bold"}}]);
  const res = (txt,v) => body.push([{content:txt,styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(v),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  let tIng=0,tCos=0,tGas=0,tImp=0,tFin=0;
  sub("INGRESOS"); grupos.ingresos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tIng+=v;}); tot("Total INGRESOS",tIng);
  if(grupos.costos.length){sub("COSTOS (directos)");grupos.costos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tCos+=v;});tot("Total Costos",tCos);}
  res("RESULTADO BRUTO", tIng-tCos);
  sub("GASTOS (administración)"); grupos.gastos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tGas+=v;}); tot("Total Gastos",tGas);
  res("RESULTADO OPERATIVO", tIng-tCos-tGas);
  if(grupos.impuestos.length){sub("IMPUESTOS");grupos.impuestos.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tImp+=v;});tot("Total IMPUESTOS",tImp);}
  if(grupos.financieros.length){sub("FINANCIEROS");grupos.financieros.forEach(r=>{const v=Math.abs(r.monto);body.push([r.rubro,_money(v)]);tFin+=v;});tot("Total FINANCIEROS",tFin);}
  res("RESULTADO NETO", tIng-tCos-tGas-tImp-tFin);
  doc.autoTable({ startY:y+6, head:[["Categoría","Monto"]], body, theme:"grid",
    headStyles:{fillColor:[11,31,58],textColor:[255,255,255]}, columnStyles:{1:{halign:"right"}}, styles:{fontSize:9} });
  let fy = doc.lastAutoTable.finalY + 14;
  doc.setFontSize(8); doc.setTextColor(90,90,90);
  doc.text("Devengado = se imputa a la fecha de emisión del comprobante, no a la de cobro/pago (a diferencia del Flujo de Caja).", 40, fy);
  doc.save(`Estado_de_Resultados_${label.replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 4. SUMAS Y SALDOS
// ════════════════════════════════════════════════════════════════
async function exportarSumasSaldosXlsx(cuentas, label) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sumas y Saldos");
  ws.columns = [{width:48},{width:16},{width:16}];
  let r = await _xlsEncabezado(ws, wb, "Sumas y Saldos (vista de gestión)", `Periodo: ${label}  ·  Corte: ${_hoyTxt()}`);
  const setMoney = (cell, v) => { cell.value = v; cell.numFmt = XLS_MONEY; cell.alignment = { horizontal: "right" }; };
  const hr = ws.getRow(r); ["Cuenta","Debe","Haber"].forEach((h,i)=>{ hr.getCell(i+1).value = h; _xlsHeader(hr.getCell(i+1)); }); r++;
  cuentas.forEach(c => { const row = ws.getRow(r); row.getCell(1).value = c.nombre; if(c.debe) setMoney(row.getCell(2), c.debe); if(c.haber) setMoney(row.getCell(3), c.haber); r++; });
  const totD = cuentas.reduce((s,c)=>s+(c.debe||0),0), totH = cuentas.reduce((s,c)=>s+(c.haber||0),0);
  const tr = ws.getRow(r); tr.getCell(1).value = "TOTAL"; _xlsResult(tr.getCell(1)); setMoney(tr.getCell(2), totD); _xlsResult(tr.getCell(2)); setMoney(tr.getCell(3), totH); _xlsResult(tr.getCell(3)); r++;
  const dr = ws.getRow(r); dr.getCell(1).value = "Diferencia (Debe − Haber)"; dr.getCell(1).font = { bold:true }; setMoney(dr.getCell(2), totD-totH); dr.getCell(2).font = { bold:true }; r += 2;
  ws.mergeCells(r,1,r,3);
  const adv = ws.getRow(r).getCell(1);
  adv.value = "ADVERTENCIA: el Debe y el Haber NO cierran en cero porque no se registra una cuenta de Patrimonio/Capital inicial. Es una vista de gestión, no un balance contable legal.";
  adv.font = { bold:true, color:{argb:"FFB23A3A"}, size:9 };
  adv.fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFBEDED"} };
  adv.alignment = { wrapText:true, vertical:"top" };
  ws.getRow(r).height = 32;
  await _xlsSave(wb, `Sumas_y_Saldos_${label.replace(/\s+/g,"_")}.xlsx`);
}

function exportarSumasSaldosPdf(cuentas, label) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  let y = agregarEncabezadoPDF(doc, _emp());
  doc.setTextColor(11,31,58); doc.setFont("helvetica","bold"); doc.setFontSize(13);
  doc.text("Sumas y Saldos (vista de gestión)", 40, y); y+=16;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(120,120,120);
  doc.text(`Periodo: ${label}  ·  Corte: ${_hoyTxt()}`, 40, y); y+=8;

  const body = cuentas.map(c => [c.nombre, c.debe?_money(c.debe):"—", c.haber?_money(c.haber):"—"]);
  const totD = cuentas.reduce((s,c)=>s+(c.debe||0),0), totH = cuentas.reduce((s,c)=>s+(c.haber||0),0);
  body.push([{content:"TOTAL",styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(totD),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}},{content:_money(totH),styles:{fillColor:[11,31,58],textColor:[255,255,255],fontStyle:"bold"}}]);
  body.push([{content:"Diferencia (Debe − Haber)",styles:{fontStyle:"bold"}},{content:_money(totD-totH),styles:{fontStyle:"bold"}},""]);
  doc.autoTable({ startY:y+6, head:[["Cuenta","Debe","Haber"]], body, theme:"grid",
    headStyles:{fillColor:[11,31,58],textColor:[255,255,255]}, columnStyles:{1:{halign:"right"},2:{halign:"right"}}, styles:{fontSize:9} });
  let fy = doc.lastAutoTable.finalY + 16;
  doc.setFillColor(251,237,237); doc.rect(40, fy, 515, 40, "F");
  doc.setTextColor(178,58,58); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
  doc.text("ADVERTENCIA: el Debe y el Haber no cierran en cero porque no se registra una cuenta de", 50, fy+16);
  doc.text("Patrimonio/Capital inicial. Es una vista de gestión, no un balance contable legal.", 50, fy+29);
  doc.save(`Sumas_y_Saldos_${label.replace(/\s+/g,"_")}.pdf`);
}

// ════════════════════════════════════════════════════════════════
// 5. REPORTE FISCAL-FINANCIERO (multi-hoja, estilo Copilot)
// ════════════════════════════════════════════════════════════════
// Consolida ventas, compras, IVA, retenciones y caja en un Excel de
// varias hojas: Dashboard, Indicadores mensuales, Posición IVA,
// Recomendaciones, Metodología. Datos de state (comprobantes/retenciones).

function _mesDe(iso) { return iso ? iso.slice(0,7) : ""; }

async function exportarReporteFiscalExcel() {
  const comps = state.comprobantes || [];
  const rets = state.retenciones || [];
  const ventas = comps.filter(c => c.tipo === "cobrar");
  const compras = comps.filter(c => c.tipo === "pagar");

  // Indicadores mensuales
  const meses = {};
  const bucket = (m) => (meses[m] = meses[m] || { ventasNeto:0, facturacion:0, ivaDebito:0, comprasBase:0, comprasTotal:0, ivaCredito:0 });
  ventas.forEach(c => { const m=_mesDe(c.emision); if(!m)return; const b=bucket(m); b.ventasNeto+=(c.neto||0); b.facturacion+=(c.monto||0); b.ivaDebito+=(c.iva||0); });
  compras.forEach(c => { const m=_mesDe(c.emision); if(!m)return; const b=bucket(m); b.comprasBase+=(c.neto||0); b.comprasTotal+=(c.monto||0); b.ivaCredito+=(c.iva||0); });
  const mesesOrd = Object.keys(meses).sort();
  const ultMes = mesesOrd[mesesOrd.length-1];
  const u = ultMes ? meses[ultMes] : { ventasNeto:0,facturacion:0,ivaDebito:0,ivaCredito:0 };
  const retIVA = rets.filter(r => (r.impuesto||"").toUpperCase().includes("IVA") && _mesDe(r.fecha) === ultMes).reduce((s,r)=>s+(r.importe||0),0);
  const ivaPreliminar = u.ivaDebito - u.ivaCredito - retIVA;
  const totalVentasNeto = ventas.reduce((s,c)=>s+(c.neto||0),0);
  const totalComprasBase = compras.reduce((s,c)=>s+(c.neto||0),0);
  const resultadoDoc = totalVentasNeto - totalComprasBase;

  const wb = new ExcelJS.Workbook();
  const setMoney = (cell, v) => { cell.value = v; cell.numFmt = XLS_MONEY; cell.alignment = { horizontal: "right" }; };

  // ── Hoja Dashboard ──
  const wsD = wb.addWorksheet("Dashboard");
  wsD.columns = [{width:34},{width:20}];
  let r = await _xlsEncabezado(wsD, wb, "REPORTE FISCAL Y FINANCIERO", ultMes ? `Último período: ${ultMes}` : "");
  const kpi = (txt, v, money=true) => { const row = wsD.getRow(r); row.getCell(1).value = txt; row.getCell(1).font={bold:true,color:{argb:XLS_NAVY}}; if(money) setMoney(row.getCell(2), v); else { row.getCell(2).value=v; row.getCell(2).alignment={horizontal:"right"}; } r++; };
  kpi("Ventas netas (últ. mes)", u.ventasNeto);
  kpi("Facturación (últ. mes)", u.facturacion);
  kpi("IVA débito (últ. mes)", u.ivaDebito);
  kpi("IVA crédito (últ. mes)", u.ivaCredito);
  kpi("Retenciones/percepciones IVA", retIVA);
  const rPre = wsD.getRow(r); rPre.getCell(1).value="IVA preliminar"; _xlsResult(rPre.getCell(1)); setMoney(rPre.getCell(2), ivaPreliminar); _xlsResult(rPre.getCell(2)); r++;
  r++;
  kpi("Resultado documental (total)", resultadoDoc);
  kpi("Comprobantes emitidos", ventas.length, false);
  kpi("Comprobantes recibidos", compras.length, false);
  r++;
  const rLect = wsD.getRow(r); rLect.getCell(1).value = "Lectura ejecutiva"; _xlsSection(rLect.getCell(1)); _xlsSection(rLect.getCell(2)); r++;
  [ (ivaPreliminar>0?"• IVA preliminar a pagar en el período (validar créditos con el contador).":"• Saldo de IVA a favor en el período."),
    "• Las ventas netas documentadas surgen del Libro IVA.",
    "• El resultado documental NO es la base imponible de Ganancias.",
    "• La caja requiere conciliación bancaria." ].forEach(t => { wsD.getRow(r).getCell(1).value=t; wsD.getRow(r).getCell(1).font={size:10,color:{argb:"FF444444"}}; r++; });

  // ── Hoja Indicadores mensuales ──
  const wsI = wb.addWorksheet("Indicadores_Mensuales");
  wsI.columns = [{width:10},{width:15},{width:15},{width:14},{width:14},{width:15},{width:13},{width:14}];
  let ri = await _xlsEncabezado(wsI, wb, "INDICADORES MENSUALES", "Evolución por período");
  const hI = wsI.getRow(ri);
  ["Período","Ventas netas","Facturación","IVA débito","Compras base","Compras total","IVA crédito","IVA preliminar"].forEach((h,i)=>{ hI.getCell(i+1).value=h; _xlsHeader(hI.getCell(i+1)); }); ri++;
  mesesOrd.forEach(m => { const b=meses[m]; const row=wsI.getRow(ri);
    row.getCell(1).value=m; setMoney(row.getCell(2),b.ventasNeto); setMoney(row.getCell(3),b.facturacion);
    setMoney(row.getCell(4),b.ivaDebito); setMoney(row.getCell(5),b.comprasBase); setMoney(row.getCell(6),b.comprasTotal);
    setMoney(row.getCell(7),b.ivaCredito); setMoney(row.getCell(8),b.ivaDebito-b.ivaCredito); ri++;
  });

  // ── Hoja Posición IVA ──
  const wsP = wb.addWorksheet("Posicion_IVA");
  wsP.columns = [{width:38},{width:16}];
  let rp = await _xlsEncabezado(wsP, wb, "POSICIÓN DE IVA", ultMes || "");
  const hP = wsP.getRow(rp); hP.getCell(1).value="Concepto"; hP.getCell(2).value="Monto"; _xlsHeader(hP.getCell(1)); _xlsHeader(hP.getCell(2)); rp++;
  [["IVA débito (ventas)",u.ivaDebito],["IVA crédito computable (compras)",u.ivaCredito],["Retenciones/percepciones IVA",retIVA]].forEach(([t,v])=>{ const row=wsP.getRow(rp); row.getCell(1).value=t; setMoney(row.getCell(2),v); rp++; });
  const rPos = wsP.getRow(rp); rPos.getCell(1).value="POSICIÓN (débito − crédito − ret.)"; _xlsResult(rPos.getCell(1)); setMoney(rPos.getCell(2), ivaPreliminar); _xlsResult(rPos.getCell(2));

  // ── Hoja Recomendaciones ──
  const wsR = wb.addWorksheet("Recomendaciones");
  wsR.columns = [{width:12},{width:22},{width:40},{width:42},{width:12},{width:32}];
  let rr = await _xlsEncabezado(wsR, wb, "RECOMENDACIONES DEL MODELO", "Requieren aprobación profesional");
  const hR = wsR.getRow(rr); ["Variable","Condición","Diagnóstico","Recomendación","Prioridad","Evidencia"].forEach((h,i)=>{ hR.getCell(i+1).value=h; _xlsHeader(hR.getCell(i+1)); }); rr++;
  if (typeof calcularFiscal==="function" && typeof recomendacionesFiscales==="function" && typeof estimarGanancias==="function") {
    const f = calcularFiscal("1900-01-01","2100-12-31");
    recomendacionesFiscales(f, estimarGanancias(f)).forEach(rec => {
      const row = wsR.getRow(rr);
      row.getCell(1).value=rec.variable; row.getCell(2).value=rec.condicion; row.getCell(3).value=rec.diagnostico;
      row.getCell(4).value=rec.accion; row.getCell(5).value=rec.prioridad; row.getCell(6).value=(rec.evidencia||[]).join(", ");
      row.alignment = { wrapText:true, vertical:"top" };
      rr++;
    });
  }

  // ── Hoja Metodología ──
  const wsM = wb.addWorksheet("Metodologia");
  wsM.columns = [{width:22},{width:72}];
  let rm = await _xlsEncabezado(wsM, wb, "METODOLOGÍA Y LIMITACIONES", "");
  const hM = wsM.getRow(rm); hM.getCell(1).value="Concepto"; hM.getCell(2).value="Definición"; _xlsHeader(hM.getCell(1)); _xlsHeader(hM.getCell(2)); rm++;
  [["Ventas netas","Neto gravado + no gravado + exento de comprobantes emitidos."],
   ["Compras base","Neto gravado + no gravado + exento de comprobantes recibidos."],
   ["IVA débito","IVA de comprobantes de venta."],
   ["IVA crédito","IVA de compras validadas como computables (no se computa por defecto)."],
   ["IVA preliminar","IVA débito − IVA crédito computable − retenciones/percepciones IVA del período."],
   ["Resultado documental","Ventas netas − compras base. NO es la base imponible de Ganancias."],
   ["Ganancias","Requiere puente contable-fiscal (balance, ajustes, amortizaciones, quebrantos)."]
  ].forEach(([c,d])=>{ const row=wsM.getRow(rm); row.getCell(1).value=c; row.getCell(1).font={bold:true}; row.getCell(2).value=d; row.getCell(2).alignment={wrapText:true}; rm++; });

  await _xlsSave(wb, `Reporte_Fiscal_Financiero_${_hoyTxt().replace(/\//g,"-")}.xlsx`);
}
