// costo_dinero.js — Motor de "costo del dinero": lleva cada alternativa a
// tasa NETA en dólares comparable, con el dólar quieto como línea de base.
// Catálogo abierto por categorías A/B/C/D (sección 3 de la spec).

const COSTO_CATALOGO = [
  { id:"fci_mm",   cat:"A", nombre:"FCI Money Market",             moneda:"ARS", tipoImp:"corporativo", tasaRef:40, live:"fci" },
  { id:"lecap",    cat:"A", nombre:"LECAP (Letra del Tesoro)",     moneda:"ARS", tipoImp:"publico",     tasaRef:48 },
  { id:"pf",       cat:"A", nombre:"Plazo fijo",                   moneda:"ARS", tipoImp:"corporativo", tasaRef:45, live:"pf" },
  { id:"dlk",      cat:"B", nombre:"Bono dólar-linked (soberano)", moneda:"ARS", tipoImp:"publico",     spreadRef:4 },
  { id:"on_usd",   cat:"C", nombre:"ON en dólares",                moneda:"USD", tipoImp:"corporativo", tasaRef:8 },
  { id:"bono_usd", cat:"C", nombre:"Bono soberano en dólares",     moneda:"USD", tipoImp:"publico",     tasaRef:11 },
  { id:"dolar",    cat:"D", nombre:"Dólar quieto (billete/cuenta)",moneda:"USD", tipoImp:"publico",     tasaRef:0 },
];
const COSTO_CAT_LABEL = { A:"Pesos tasa fija", B:"Pesos con cobertura", C:"Dólares tasa fija", D:"Dólar quieto" };

// Tasa neta anual en USD de un instrumento, dados los supuestos y el régimen.
function tasaNetaUSD(inst, sup, regimen) {
  const dev = (parseFloat(sup.devaluacion) || 0) / 100;
  const alicSoc = (parseFloat(sup.alicuotaGananciasSociedad) || 0) / 100;
  const alicPer = (parseFloat(sup.alicuotaGananciasPersona) || 0) / 100;
  // Los títulos públicos van exentos; los corporativos pagan Ganancias.
  const alic = inst.tipoImp === "publico" ? 0 : (regimen === "persona" ? alicPer : alicSoc);
  if (inst.cat === "D") return 0;                                   // dólar quieto: base 0
  if (inst.cat === "C") { const rUsd = (inst.tasaRef || 0) / 100; return rUsd * (1 - alic); }
  // Cat A y B: instrumentos en pesos → carry a dólares
  let rArs;
  if (inst.cat === "B") rArs = dev + (inst.spreadRef || 0) / 100;   // dólar-linked ≈ devaluación + spread
  else rArs = (inst.tasaRef || 0) / 100;
  const rArsNet = rArs * (1 - alic);
  return (1 + rArsNet) / (1 + dev) - 1;
}

// Aplica tasas en vivo (si hay) y devuelve las filas ordenadas por neta USD desc.
function analizarCostoDinero(sup, regimen, live) {
  live = live || {};
  const cat = COSTO_CATALOGO.map(i => ({ ...i }));
  cat.forEach(i => {
    if (i.live === "fci" && live.fci != null) i.tasaRef = live.fci;
    if (i.live === "pf" && live.pf != null) i.tasaRef = live.pf;
    if (i.live === "caucion" && live.caucion != null) i.tasaRef = live.caucion;
  });
  const rows = cat.map(i => ({
    inst: i,
    bruta: i.cat === "B" ? ((parseFloat(sup.devaluacion) || 0) + (i.spreadRef || 0)) : (i.tasaRef || 0),
    netaUSD: tasaNetaUSD(i, sup, regimen),
  }));
  rows.sort((a, b) => b.netaUSD - a.netaUSD);
  return rows;
}
