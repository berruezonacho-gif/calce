// demo_constructora.js — EJEMPLO FICTICIO (no es un cliente real).
// Pensado para mostrar la sección de Inversiones: una constructora estaciona
// el excedente de caja en FCI money market, plazo fijo, dólares, caución y bono.
const DEMO_CONSTRUCTORA = {
  empresa: { nombre: "Constructora Demo S.A.", cuit: "30-71234567-9", provincia: "CABA", modo: "completo" },

  accounts: [
    { id: "cc",   name: "Cuenta corriente",   banco: "Banco Galicia", tipo: "cc", moneda: "ARS", alias: "constructora.cc", opening: 78000000 },
    { id: "usd",  name: "Cuenta en dólares",  banco: "Banco Galicia", tipo: "cc", moneda: "USD", alias: "constructora.usd", opening: 40000 },
    { id: "comitente", name: "Cuenta comitente", banco: "Balanz", tipo: "comitente", moneda: "ARS", alias: "", opening: 15000000 },
    { id: "caja", name: "Efectivo",           banco: "", tipo: "efectivo", moneda: "ARS", alias: "", opening: 1200000 },
  ],

  // Flujo típico de una constructora (ingresos por certificados de obra, egresos
  // por subcontratistas, materiales, sueldos y maquinaria).
  movements: [
    { label: "Certificado de obra — Municipio", amount: 42000000, date: "d+12", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Anticipo obra privada — Cliente A", amount: 18000000, date: "d+3", recurrence: "none", medio: "transferencia", account: "cc" },
    { label: "Subcontratistas (mano de obra)", amount: -16500000, date: "d+15", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Sueldos y cargas sociales", amount: -22000000, date: "d+5", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Corralón / materiales", amount: -12800000, date: "d+8", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Alquiler de maquinaria", amount: -3400000, date: "d+10", recurrence: "monthly", medio: "transferencia", account: "cc" },
    { label: "Combustible y logística", amount: -1900000, date: "d+18", recurrence: "monthly", medio: "transferencia", account: "cc" },
  ],

  // El corazón del demo: colocaciones de excedente.
  investments: [
    { tipo: "fci", label: "FCI Money Market (liquidez)", monto: 25000000, sociedad: "Balanz Money Market",
      account: "cc", fechaColocacion: "d-6", fechaVenc: null, rendimiento: 42, estado: "activa" },
    { tipo: "plazo_fijo", label: "Plazo fijo 30 días", monto: 20000000, sociedad: "Banco Galicia",
      account: "cc", fechaColocacion: "d-10", fechaVenc: "d+20", rendimiento: 47, estado: "activa" },
    { tipo: "dolares", label: "Dólares (cobertura de obra)", monto: 30000, sociedad: "MEP",
      account: "usd", fechaColocacion: "d-20", fechaVenc: null, rendimiento: 0, estado: "activa" },
    { tipo: "caucion", label: "Caución colocadora 7 días", monto: 12000000, sociedad: "Balanz",
      account: "comitente", fechaColocacion: "d-2", fechaVenc: "d+5", rendimiento: 40, estado: "activa" },
    { tipo: "bono", label: "Bono soberano corto (AL30)", monto: 9000000, sociedad: "Balanz",
      account: "comitente", fechaColocacion: "d-45", fechaVenc: "d+120", rendimiento: 52, estado: "activa" },
  ],

  proveedores: [
    { nombre: "Aceros del Sur S.A.", cuit: "30-65111222-3", rubro: "Materiales (acero)", contacto: "Ventas", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
    { nombre: "Hormigones Pilar S.R.L.", cuit: "30-66222333-4", rubro: "Hormigón elaborado", contacto: "Pedidos", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 15 },
    { nombre: "Alquiler de Grúas Norte", cuit: "30-67333444-5", rubro: "Maquinaria", contacto: "Logística", email: "", telefono: "", cbu: "", condicionIVA: "Responsable Inscripto", plazoPago: 30 },
  ],

  retenciones: [],
};
