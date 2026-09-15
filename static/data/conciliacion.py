"""
data/conciliacion.py — Conciliación bancaria.

Compara el extracto real del banco contra los movimientos proyectados en el flujo
de caja, para detectar:
  - Coincidencias: lo que esperabas cobrar/pagar y efectivamente pasó.
  - Faltantes: movimientos proyectados que todavía no aparecen en el banco.
  - Sorpresas: movimientos en el banco que no estaban proyectados.
  - Desvíos: montos que difieren (esperabas $500k, entraron $480k).

El problema: cada banco exporta el extracto en un formato distinto (columnas,
nombres, orden). Se resuelve con el mismo parser flexible del importador, que
detecta las columnas por nombre, más una tolerancia configurable para el match
por fecha y monto.

El match es aproximado: dos movimientos concilian si su monto coincide dentro de
una tolerancia y sus fechas están dentro de una ventana de días (los pagos rara
vez caen el día exacto proyectado).
"""
from __future__ import annotations

from datetime import date, timedelta


def _to_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def conciliar(
    proyectados: list[dict],
    extracto: list[dict],
    tolerancia_monto: float = 0.02,   # 2% de diferencia aceptable
    ventana_dias: int = 5,
) -> dict:
    """Concilia movimientos proyectados contra el extracto bancario.

    proyectados: [{date, amount, label}] — del cash flow.
    extracto: [{date, amount, label}] — importado del banco.
    tolerancia_monto: diferencia relativa aceptable para considerar match (0.02 = 2%).
    ventana_dias: días de diferencia aceptables entre fecha proyectada y real.

    Devuelve conciliados, faltantes (proyectado sin match), sorpresas (banco sin
    match) y desvíos (match con diferencia de monto).
    """
    # Normalizar
    proj = []
    for i, m in enumerate(proyectados):
        d = _to_date(m.get("date"))
        amt = float(m.get("amount") or 0)
        if d and amt:
            proj.append({"i": i, "date": d, "amount": amt, "label": m.get("label", ""), "matched": False})

    bank = []
    for i, m in enumerate(extracto):
        d = _to_date(m.get("date"))
        amt = float(m.get("amount") or 0)
        if d and amt:
            bank.append({"i": i, "date": d, "amount": amt, "label": m.get("label", ""), "matched": False})

    conciliados = []
    desvios = []

    # Emparejar: para cada proyectado, buscar el mejor candidato en el banco
    for p in proj:
        best = None
        best_score = None
        for b in bank:
            if b["matched"]:
                continue
            # Mismo signo (entrada con entrada, salida con salida)
            if (p["amount"] > 0) != (b["amount"] > 0):
                continue
            dias = abs((b["date"] - p["date"]).days)
            if dias > ventana_dias:
                continue
            diff_rel = abs(b["amount"] - p["amount"]) / abs(p["amount"]) if p["amount"] else 1
            # Score: prioriza menor diferencia de monto y de días
            score = diff_rel * 100 + dias
            if best is None or score < best_score:
                best = b
                best_score = score
        if best is not None:
            p["matched"] = True
            best["matched"] = True
            diff = best["amount"] - p["amount"]
            diff_rel = abs(diff) / abs(p["amount"]) if p["amount"] else 0
            entry = {
                "label": p["label"] or best["label"],
                "fecha_proyectada": p["date"].isoformat(),
                "fecha_real": best["date"].isoformat(),
                "monto_proyectado": round(p["amount"], 2),
                "monto_real": round(best["amount"], 2),
                "diferencia": round(diff, 2),
                "dias_desvio": (best["date"] - p["date"]).days,
            }
            if diff_rel > tolerancia_monto:
                desvios.append(entry)
            else:
                conciliados.append(entry)

    faltantes = [{
        "label": p["label"], "fecha": p["date"].isoformat(),
        "monto": round(p["amount"], 2),
    } for p in proj if not p["matched"]]

    sorpresas = [{
        "label": b["label"], "fecha": b["date"].isoformat(),
        "monto": round(b["amount"], 2),
    } for b in bank if not b["matched"]]

    total_proj = len(proj)
    total_conc = len(conciliados) + len(desvios)
    return {
        "ok": True,
        "resumen": {
            "proyectados": total_proj,
            "conciliados": len(conciliados),
            "desvios": len(desvios),
            "faltantes": len(faltantes),
            "sorpresas": len(sorpresas),
            "tasa_conciliacion": round(total_conc / total_proj * 100, 1) if total_proj else 0,
        },
        "conciliados": conciliados,
        "desvios": desvios,
        "faltantes": faltantes,
        "sorpresas": sorpresas,
    }
