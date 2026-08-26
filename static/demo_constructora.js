// ─────────────────────────────────────────────────────────────
// DEMO: "Constructora del Plata S.R.L."
// PyME constructora argentina. Datos ficticios pero realistas,
// pensados para mostrar la app y estresar el modelo de datos.
//
// Perfil: empresa con 2 obras en curso (un edificio y una refacción
// de local comercial para un cliente corporativo), ~18 empleados,
// factura ~$45M/mes, opera con certificaciones de obra, anticipos,
// acopio de materiales y varios subcontratistas.
//
// Se carga con ?demo=constructora
// ─────────────────────────────────────────────────────────────

const DEMO_CONSTRUCTORA = {
  empresa: {
    nombre: "Constructora del Plata S.R.L.",
    cuit: "30-71234567-8",
    provincia: "Buenos Aires",
  },
  prefs: { moneda: "ARS", formatoFecha: "dd/mm/aaaa", colchon: 8000000, horizonte: 90 },
  impuestos: { iva: 21, iibb: 3.5 },
  accounts: [
    { id: "bna-cc",   name: "Cuenta corriente operativa", banco: "Banco de la Nación Argentina", tipo: "cc", moneda: "ARS", alias: "constplata.bna.cc", opening: 12400000 },
    { id: "gali-ca",  name: "Caja de ahorro haberes",     banco: "Banco de Galicia y Buenos Aires (Galicia)", tipo: "ca", moneda: "ARS", alias: "constplata.sueldos", opening: 3100000 },
    { id: "prov-cc",  name: "Cuenta obra pública",        banco: "Banco de la Provincia de Buenos Aires (Provincia)", tipo: "cc", moneda: "ARS", alias: "constplata.obrapublica", opening: 6800000 },
    { id: "usd-ca",   name: "Caja de ahorro USD",         banco: "Banco de la Nación Argentina", tipo: "ca", moneda: "USD", alias: "constplata.usd", opening: 4200000 },
    { id: "caja",     name: "Caja chica de obra",         banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 850000 },
  ],
  // Los montos son mensuales/recurrentes salvo aclaración.
  // account por id. medio: transferencia / cheque / efectivo / tarjeta
  movements: [
    // ── INGRESOS ────────────────────────────────────────────
    // Certificación de obra mensual (edificio) - cliente privado
    { label: "Certificación obra Edificio Nordelta", amount: 22000000, date: "d+8",  recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    // Certificación refacción local (cliente corporativo, paga a 30-45d)
    { label: "Certificación refacción Local Centro", amount: 9500000, date: "d+22", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    // Anticipo financiero de nueva obra (una vez)
    { label: "Anticipo obra pública Municipio", amount: 18000000, date: "d+35", recurrence: "none", medio: "transferencia", account: "prov-cc" },
    // Certificación obra pública (mensual, con retraso típico del Estado)
    { label: "Certificación obra pública Escuela", amount: 14000000, date: "d+40", recurrence: "monthly", medio: "transferencia", account: "prov-cc" },
    // Venta de excedente de materiales
    { label: "Venta materiales sobrantes", amount: 1200000, date: "d+18", recurrence: "none", medio: "efectivo", account: "caja" },

    // ── EGRESOS: MANO DE OBRA ───────────────────────────────
    // Sueldos personal de obra (quincena 1 y 2)
    { label: "Sueldos personal de obra (1ra quincena)", amount: -8500000, date: "d+5",  recurrence: "monthly", medio: "transferencia", account: "gali-ca" },
    { label: "Sueldos personal de obra (2da quincena)", amount: -8500000, date: "d+20", recurrence: "monthly", medio: "transferencia", account: "gali-ca" },
    // Cargas sociales (UOCRA + AFIP)
    { label: "Cargas sociales UOCRA + AFIP", amount: -6200000, date: "d+12", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    // Fondo de cese laboral UOCRA
    { label: "Fondo de cese laboral UOCRA", amount: -1400000, date: "d+12", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    // Administración (sueldos oficina)
    { label: "Sueldos administración", amount: -3800000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "gali-ca" },

    // ── EGRESOS: MATERIALES Y SUBCONTRATOS ──────────────────
    // Corralón - compra de materiales (recurrente, grande)
    { label: "Corralón - hormigón y hierro", amount: -7800000, date: "d+10", recurrence: "monthly", medio: "cheque", account: "bna-cc" },
    { label: "Corralón - materiales varios", amount: -3200000, date: "d+25", recurrence: "monthly", medio: "cheque", account: "bna-cc" },
    // Acopio de materiales (compra grande única para asegurar precio)
    { label: "Acopio cemento (anticipo precio)", amount: -5500000, date: "d+15", recurrence: "none", medio: "transferencia", account: "bna-cc" },
    // Subcontratistas
    { label: "Subcontrato instalación eléctrica", amount: -4200000, date: "d+16", recurrence: "monthly", medio: "cheque", account: "bna-cc" },
    { label: "Subcontrato plomería y sanitarios", amount: -2800000, date: "d+18", recurrence: "monthly", medio: "cheque", account: "bna-cc" },
    { label: "Subcontrato movimiento de suelos", amount: -3600000, date: "d+28", recurrence: "none", medio: "transferencia", account: "prov-cc" },
    // Alquiler de equipos (grúa, encofrados)
    { label: "Alquiler grúa y encofrados", amount: -2100000, date: "d+7", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },

    // ── EGRESOS: ESTRUCTURA Y GASTOS FIJOS ──────────────────
    { label: "Alquiler oficina y obrador", amount: -1600000, date: "d+3", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Combustible y logística", amount: -1100000, date: "d+6", recurrence: "monthly", medio: "tarjeta", account: "bna-cc" },
    { label: "Seguros (ART, obra, vehículos)", amount: -1900000, date: "d+9", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Honorarios estudio contable", amount: -650000, date: "d+11", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Servicios (luz, agua, internet)", amount: -480000, date: "d+14", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Caja chica de obra (reposición)", amount: -600000, date: "d+13", recurrence: "monthly", medio: "efectivo", account: "caja" },

    // ── EGRESOS: IMPUESTOS ──────────────────────────────────
    { label: "IVA (saldo DGI)", amount: -4100000, date: "d+19", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Ingresos Brutos ARBA", amount: -1500000, date: "d+19", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    { label: "Anticipo Ganancias", amount: -2200000, date: "d+45", recurrence: "none", medio: "transferencia", account: "bna-cc" },
    { label: "Impuesto a los débitos y créditos", amount: -900000, date: "d+19", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },

    // ── FINANCIAMIENTO ──────────────────────────────────────
    // Cuota de leasing de camioneta / equipo
    { label: "Cuota leasing camioneta", amount: -780000, date: "d+15", recurrence: "monthly", medio: "transferencia", account: "bna-cc" },
    // Descuento de cheques / adelanto (devolución)
    { label: "Cancelación adelanto cuenta corriente", amount: -3000000, date: "d+30", recurrence: "none", medio: "transferencia", account: "bna-cc" },
  ],

  // ── INVERSIONES YA HECHAS ────────────────────────────────
  // El tesorero ya colocó excedente. El módulo genera solo los movimientos
  // de calce (egreso hoy + rescate al vencimiento) a partir de estas.
  investments: [
    // Plazo fijo: colocado hace 5 días, vence en 25 (TNA de referencia)
    { tipo: "plazo_fijo", label: "Plazo fijo Nación 30d", monto: 10000000, account: "bna-cc", fechaColocacion: "d-5", fechaVenc: "d+25", rendimiento: 42, estado: "activa" },
    // FCI money market: sin vencimiento, rescatable
    { tipo: "fci", label: "FCI money market", monto: 8000000, account: "bna-cc", fechaColocacion: "d-2", fechaVenc: null, rendimiento: 38, estado: "activa" },
    // Dólares comprados con excedente (quedan en la cuenta USD)
    { tipo: "dolares", label: "Tenencia en dólares", monto: 4900, account: "usd-ca", fechaColocacion: "d-10", fechaVenc: null, rendimiento: 0, estado: "activa" },
  ],
};
