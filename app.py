"""
app.py — Tesorería PyME: proyección de flujo de caja + inversión del excedente.

Herramienta de tesorería para PyMEs. El flujo de caja diario detecta cuánta
plata ociosa hay y cuándo; el módulo de inversión coloca ese excedente en FCI,
ONs, caución o plazo fijo según el horizonte.

Arranque limpio, separado de Hormiga Markets. Reutiliza módulos puntuales.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from data import cashflow
from data import ons_static, sovereign_static, bonds
from data import renta_fija
from data import bcra
from data import fci
from data import importer
from data import impuestos
from data import conciliacion
from data import tasas

app = FastAPI(title="Tesorería PyME")
STATIC = Path(__file__).parent / "static"
PORT = int(os.getenv("PORT", "8500"))


# ── Modelos ───────────────────────────────────────────────────────────────────
class Movement(BaseModel):
    date: str
    amount: float
    label: str = ""
    category: str = ""
    recurrence: str = "none"     # none | daily | weekly | monthly
    until: str | None = None
    medio: str = "transferencia" # transferencia | efectivo | cheque | tarjeta


class ProjectRequest(BaseModel):
    opening_balance: float = 0.0
    movements: list[Movement] = []
    horizon_days: int = 90
    min_buffer: float = 0.0
    start: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.post("/api/cashflow/project")
def cashflow_project(req: ProjectRequest):
    """Proyecta el saldo diario y detecta excedentes y faltantes."""
    from datetime import date
    start = date.fromisoformat(req.start) if req.start else None
    movs = [m.model_dump() for m in req.movements]
    result = cashflow.project(
        opening_balance=req.opening_balance,
        movements=movs,
        horizon_days=max(7, min(req.horizon_days, 730)),
        min_buffer=req.min_buffer,
        start=start,
    )
    return {
        "ok": True,
        "days": result.days,
        "surpluses": result.surpluses,
        "shortfalls": result.shortfalls,
        "summary": result.summary,
    }


@app.get("/api/inversiones/soberanos")
def inversiones_soberanos():
    """Lista de bonos soberanos disponibles para invertir el excedente."""
    bonds_list = []
    for sym in sovereign_static.all_bonds():
        terms = sovereign_static._resolve(sym, sovereign_static._load())
        if terms:
            bonds_list.append({
                "symbol": sym,
                "name": terms.get("name"),
                "law": terms.get("law"),
                "currency": terms.get("currency", "USD"),
            })
    return {"ok": True, "count": len(bonds_list), "bonds": bonds_list}


@app.get("/api/inversiones/ons")
def inversiones_ons():
    """Lista de ONs con condiciones de emisión curadas."""
    terms = ons_static.list_terms()
    return {"ok": True, "count": len(terms), "ons": terms}


@app.get("/api/inversiones/lecaps")
def inversiones_lecaps():
    """Lista de LECAPs/BONCAPs disponibles con su valor final y vencimiento.

    Las letras capitalizables no pagan cupón: se compran con descuento y pagan
    el valor final al vencimiento. Requiere precios en vivo de BYMA para el
    precio actual; el valor final es fijo de emisión.
    """
    boards = renta_fija.boards()
    fams = boards.get("families", {})
    out = []
    for fam in ("lecaps", "boncaps"):
        for b in fams.get(fam, []):
            if not b.get("has_terms"):
                continue
            out.append({
                "ticker": b["ticker"],
                "tipo": "BONCAP" if fam == "boncaps" else "LECAP",
                "price": b.get("price"),
                "valor_final": b.get("valor_final"),
                "maturity": b.get("maturity"),
                "days": b.get("days"),
                "tna_pct": b.get("tna_pct"),
                "tem_pct": b.get("tem_pct"),
            })
    out.sort(key=lambda x: x.get("days") or 9999)
    return {"ok": True, "count": len(out), "lecaps": out}


@app.get("/api/inversiones/lecap-simular")
def inversiones_lecap_simular(symbol: str, amount: float, price: float = 0, valor_final: float = 0, days: int = 0):
    """Simula invertir en una LECAP/BONCAP.

    Comprás `amount` a `price` (por 100 VN) y cobrás el valor final al
    vencimiento. Calcula nominales, total a cobrar, ganancia, TNA y TEM.
    Si no se pasan price/valor_final/days, los busca en los tableros en vivo.
    """
    symbol = symbol.upper()
    if not (price and valor_final and days):
        boards = renta_fija.boards()
        fams = boards.get("families", {})
        found = None
        for fam in ("lecaps", "boncaps"):
            for b in fams.get(fam, []):
                if b.get("ticker") == symbol:
                    found = b
                    break
        if not found:
            return {"ok": False, "error": f"{symbol} no está en los tableros ahora (requiere BYMA en vivo)."}
        price = price or found.get("price")
        valor_final = valor_final or found.get("valor_final")
        days = days or found.get("days")
    if not (price and valor_final):
        return {"ok": False, "error": "Faltan precio o valor final."}
    nominales = amount / price * 100.0
    total = nominales * valor_final / 100.0
    ganancia = total - amount
    ratio = valor_final / price
    tna = ((ratio - 1) * (365 / days)) * 100 if days else None
    tem = ((ratio ** (30 / days) - 1)) * 100 if days else None
    return {
        "ok": True, "symbol": symbol, "invested": round(amount, 2),
        "price": price, "valor_final": valor_final, "days": days,
        "nominales": round(nominales, 2),
        "total_to_collect": round(total, 2),
        "total_return": round(ganancia, 2),
        "return_pct": round((total / amount - 1) * 100, 2) if amount else None,
        "tna_pct": round(tna, 2) if tna is not None else None,
        "tem_pct": round(tem, 2) if tem is not None else None,
        "maturity_note": "Cobrás todo junto al vencimiento (no paga cupones).",
    }


@app.get("/api/inversiones/simular")
def inversiones_simular(symbol: str, amount: float, price: float, kind: str = "soberano"):
    """Simula invertir un monto (el excedente) en un bono soberano u ON.

    Devuelve el flujo de cobros escalado: cuándo y cuánto se cobra, renta,
    amortización y retorno total. kind = soberano | on.
    """
    if kind == "soberano":
        return sovereign_static.simulate(symbol.upper(), amount, price)
    # Para ONs, usar la calculadora de bonds con los términos curados
    terms = ons_static.emission_terms(symbol.upper())
    if not terms:
        return {"ok": False, "error": f"ON {symbol} sin términos curados."}
    flows = bonds.build_cashflow(
        coupon_rate=terms.get("coupon_rate") or 0,
        frequency=terms.get("frequency") or 2,
        maturity=terms.get("maturity"),
        amort_start=terms.get("amort_start"),
        amort_count=terms.get("amort_count") or 1,
    )
    if not flows or not price:
        return {"ok": False, "error": "No se pudo calcular el flujo."}
    nominales = amount / price * 100.0
    factor = nominales / 100.0
    schedule = []
    total_int = total_prin = 0.0
    for f in flows:
        interest = f["interest"] * factor
        principal = f["principal"] * factor
        total_int += interest
        total_prin += principal
        schedule.append({
            "date": f["date"].isoformat() if hasattr(f["date"], "isoformat") else str(f["date"]),
            "kind": "Cupón + amortización" if (interest and principal) else "Amortización" if principal else "Cupón",
            "interest": round(interest, 2),
            "principal": round(principal, 2),
            "amount": round(interest + principal, 2),
            "currency": terms.get("currency", "USD"),
        })
    total = total_int + total_prin
    return {
        "ok": True, "symbol": symbol.upper(), "name": terms.get("name"),
        "invested": round(amount, 2), "price": price,
        "nominales": round(nominales, 2),
        "total_to_collect": round(total, 2),
        "total_interest": round(total_int, 2),
        "total_principal": round(total_prin, 2),
        "total_return": round(total - amount, 2),
        "return_pct": round((total / amount - 1) * 100, 2) if amount else None,
        "next_payment": schedule[0] if schedule else None,
        "payments_count": len(schedule),
        "schedule": schedule,
    }


@app.get("/api/inversiones/calendario")
def inversiones_calendario(limit: int = 100):
    """Calendario consolidado de pagos de bonos soberanos y ONs."""
    sob = sovereign_static.payment_calendar(limit=limit)
    ons = ons_static.payment_calendar(months_ahead=12)
    return {"ok": True, "soberanos": sob, "ons": ons}


@app.get("/api/inversiones/tableros")
def inversiones_tableros(force: bool = False):
    """Tableros de renta fija por familia con métricas de mercado.

    Cada bono trae TIR, TEM, TNA, duration (MD), paridad, valor técnico, precios
    en ARS/USD/CABLE y volumen. Incluye dólares financieros (MEP/CCL por bono).
    Requiere precios en vivo de BYMA (en el servidor).
    """
    return renta_fija.boards(force=force)


@app.get("/api/mercado/variables")
def mercado_variables(force: bool = False):
    """Variables de referencia: cotizaciones de dólares (MEP/CCL/blue/oficial)
    con brechas, inflación, CER, tasas del BCRA y bandas cambiarias."""
    return bcra.variables(force=force)


@app.get("/api/mercado/carry")
def mercado_carry():
    """Carry trade en dólares de LECAPs y BONCAPs.

    El dólar de equilibrio al vencimiento = dólar hoy × (valor final / precio).
    Si el dólar al vencimiento queda por debajo del equilibrio, el carry fue
    rentable. Breakeven anual = devaluación anualizada que empata contra el dólar.
    """
    boards = renta_fija.boards()
    is_stale = boards.get("stale", False)
    fams = boards.get("families", {})
    df = boards.get("dolares_financieros", {})
    al30 = next((b for b in df.get("al", []) if b.get("ticker") == "AL30"), {})
    mep, ccl = al30.get("mep"), al30.get("ccl")
    oficial = blue = None
    try:
        oficial = (bcra._dolarapi("oficial") or {}).get("venta")
        blue = (bcra._dolarapi("blue") or {}).get("venta")
    except Exception:
        pass
    dolares = {"oficial": oficial, "mep": mep, "blue": blue, "ccl": ccl}

    rows = []
    for fam in ("boncaps", "lecaps"):
        for b in fams.get(fam, []):
            if not b.get("has_terms") or not b.get("price") or not b.get("days"):
                continue
            vf, p, d = b.get("valor_final"), b["price"], b["days"]
            if not vf:
                continue
            ratio = vf / p
            item = {
                "ticker": b["ticker"], "tipo": "BONCAP" if fam == "boncaps" else "LECAP",
                "precio": p, "dias": d, "valor_final": vf, "maturity": b.get("maturity"),
                "breakeven_anual_pct": round((ratio ** (365 / d) - 1) * 100, 1) if d > 0 else None,
            }
            for k, spot in dolares.items():
                item[f"eq_{k}"] = round(spot * ratio, 2) if spot else None
            rows.append(item)
    rows.sort(key=lambda r: r["dias"])
    from datetime import datetime as _dtm
    return {"ok": True, "dolares": dolares, "rows": rows, "stale": is_stale,
            "updated_at": _dtm.now().isoformat(timespec="minutes"),
            "bandas": bcra.bandas_cambiarias(14),
            "formula": "Dólar equilibrio = Dólar actual × (Valor final / Precio actual)"}


@app.get("/api/inversiones/analizar")
def inversiones_analizar(symbol: str, price: float, kind: str = "soberano"):
    """Análisis completo de un bono a un precio dado: TIR, duration, paridad,
    interés corrido y flujo de fondos."""
    symbol = symbol.upper()
    if kind == "soberano":
        # Los soberanos tienen cupón step-up y amortizaciones múltiples: se usa
        # el flujo real (canje 2020) vía bonds.tir/duration sobre bond_calendar.
        flows = sovereign_static.bond_calendar(symbol)
        if not flows:
            return {"ok": False, "error": f"{symbol} sin flujos curados."}
        from datetime import date as _date
        def _days(iso):
            try:
                return (_date.fromisoformat(iso[:10]) - _date.today()).days
            except Exception:
                return 0
        future = [f for f in flows if _days(f["date"]) > 1]
        if not future:
            return {"ok": False, "error": "El bono ya no tiene pagos futuros."}
        flow_tuples = [(bonds._to_date(f["date"]), f["amount"]) for f in future]
        y = bonds.tir(price, flow_tuples)
        if y is None:
            return {"ok": False, "error": "No se pudo calcular la TIR."}
        dur = bonds.duration(price, flow_tuples, y)
        first = future[0]
        residual = first.get("residual") or 100.0
        return {
            "ok": True, "symbol": symbol, "price": price,
            "tir_pct": round(y * 100, 2),
            "tna_pct": round(((1 + y) ** (1/12) - 1) * 12 * 100, 2),
            "tem_pct": round(((1 + y) ** (1/12) - 1) * 100, 2),
            "md": round(dur["modified"], 2) if dur else None,
            "duration": round(dur["macaulay"], 2) if dur else None,
            "paridad_pct": round(price / residual * 100, 1) if residual else None,
            "flujo": [{"date": f["date"], "amount": round(f["amount"], 2),
                       "interest": round(f.get("interest", 0), 2),
                       "principal": round(f.get("principal", 0), 2)} for f in future],
        }
    # ONs: cupón simple, usa build_cashflow/analyze
    terms = ons_static.emission_terms(symbol)
    if not terms:
        return {"ok": False, "error": f"{symbol} sin términos curados."}
    return bonds.analyze(
        price=price,
        coupon_rate=terms.get("coupon_rate") or 0,
        frequency=terms.get("frequency") or 2,
        maturity=terms.get("maturity"),
        amort_start=terms.get("amort_start"),
        amort_count=terms.get("amort_count") or 1,
        currency=terms.get("currency", "USD"),
        symbol=symbol,
    )


@app.get("/api/fci/money-market")
def fci_money_market(force: bool = False):
    """FCI money market con rendimientos reales de CAFCI. Ordenados por TNA."""
    return fci.money_market(force=force)


@app.get("/api/fci/simular")
def fci_simular(amount: float, tna: float, days: int = 30):
    """Proyecta cuánto rinde el excedente en un FCI money market."""
    return fci.project_investment(amount, tna, days)


@app.post("/api/cashflow/import")
async def cashflow_import(file: UploadFile = File(...)):
    """Importa movimientos desde un Excel (.xlsx) o CSV.

    Detecta columnas de fecha, concepto y monto (o entradas/salidas) por nombre.
    Devuelve los movimientos para cargarlos en la proyección.
    """
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        return {"ok": False, "error": "El archivo es muy grande (máximo 5 MB)."}
    return importer.parse_movements(content, file.filename or "")


@app.post("/api/afip/libro-iva")
async def afip_libro_iva(file: UploadFile = File(...)):
    """Importa el Libro IVA Compras de AFIP.

    Devuelve proveedores únicos (CUIT + denominación) y las facturas de
    compra con importes discriminados (neto, no gravado, exento, IVA, total).
    """
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        return {"ok": False, "error": "El archivo es muy grande (máximo 8 MB)."}
    return importer.parse_libro_iva(content, file.filename or "")


@app.post("/api/afip/retenciones")
async def afip_retenciones(file: UploadFile = File(...)):
    """Importa un export de 'Mis Retenciones y Percepciones' de AFIP.

    Funciona con SICORE, Aduana y Ganancias (mismo formato). Devuelve las
    retenciones/percepciones sufridas, agrupadas por impuesto.
    """
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        return {"ok": False, "error": "El archivo es muy grande (máximo 8 MB)."}
    return importer.parse_retenciones(content, file.filename or "")


@app.get("/api/tasas/caucion")
def tasas_caucion(force: bool = False):
    """Tasa de caución bursátil (Índice BYMA a 1 día) y curva por plazos."""
    return tasas.caucion(force=force)


@app.get("/api/tasas/plazo-fijo")
def tasas_plazo_fijo(force: bool = False):
    """Tasas de plazo fijo a 30 días por banco (API BCRA)."""
    return tasas.plazo_fijo(force=force)


@app.get("/api/tasas/simular")
def tasas_simular(amount: float, tna: float, days: int = 30):
    """Proyecta el rendimiento de caución o plazo fijo (interés simple)."""
    return tasas.project(amount, tna, days)


@app.post("/api/impuestos/estimar")
def impuestos_estimar(req: dict):
    """Estima IVA, IIBB, Ganancias e impuesto al cheque a partir de las
    operaciones (ventas/compras). Devuelve el detalle y los vencimientos para
    incorporar al flujo de caja. Estimación orientativa, no liquidación fiscal."""
    ops = req.get("operaciones", [])
    params = req.get("params")
    gan = float(req.get("ganancias_impuesto_anual") or 0)
    return impuestos.estimar(ops, params=params, ganancias_impuesto_anual=gan)


@app.post("/api/conciliacion/importar")
async def conciliacion_importar(file: UploadFile = File(...)):
    """Importa el extracto bancario (Excel/CSV) y lo parsea a movimientos.

    Usa el mismo parser flexible que el cash flow: detecta columnas por nombre,
    así que se adapta a los distintos formatos de cada banco.
    """
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        return {"ok": False, "error": "El archivo es muy grande (máximo 5 MB)."}
    return importer.parse_movements(content, file.filename or "")


@app.post("/api/conciliacion/conciliar")
def conciliacion_conciliar(req: dict):
    """Concilia los movimientos proyectados contra el extracto del banco.

    Devuelve conciliados, desvíos (monto difiere), faltantes (proyectado que no
    apareció) y sorpresas (en el banco, no proyectado).
    """
    proyectados = req.get("proyectados", [])
    extracto = req.get("extracto", [])
    tol = float(req.get("tolerancia_monto") or 0.02)
    ventana = int(req.get("ventana_dias") or 5)
    return conciliacion.conciliar(proyectados, extracto, tolerancia_monto=tol, ventana_dias=ventana)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
