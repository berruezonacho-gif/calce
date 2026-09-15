"""
data/sovereign_static.py — Calendario de pagos de bonos soberanos argentinos.

Los bonos del canje 2020 (AL/GD 29, 30, 35, 38, 41, 46) tienen cupones step-up
(la tasa sube por tramos) y amortizaciones en cuotas conocidas del prospecto.
Este módulo expande esa estructura en un calendario de pagos futuros.

A diferencia de las ONs (bullet o cuotas iguales), los soberanos tienen:
  - Tasa variable por tramos (coupon_schedule)
  - Amortizaciones parciales en fechas específicas (amort)

El cupón de cada fecha se calcula sobre el capital residual vivo (que baja con
cada amortización), aplicando la tasa vigente en ese momento.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "sovereign_flows.json"


def _load() -> dict:
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("bonos", {})
    except Exception:
        return {}


def _resolve(symbol: str, data: dict) -> dict | None:
    """Resuelve un bono, siguiendo 'same_as' si el flujo está definido en su par."""
    b = data.get(symbol)
    if not b:
        return None
    if b.get("same_as"):
        base = data.get(b["same_as"])
        if base:
            return {**base, "name": b.get("name", base.get("name")),
                    "law": b.get("law"), "symbol": symbol}
    return {**b, "symbol": symbol}


def _rate_at(coupon_schedule: list[dict], on: date) -> float:
    """Tasa vigente en una fecha dada, según el step-up."""
    rate = 0.0
    for tramo in coupon_schedule:
        try:
            desde = datetime.strptime(tramo["desde"][:10], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            continue
        if on >= desde:
            rate = tramo["tasa"]
    return rate


def _coupon_dates(months: list[int], day: int, start: date, end: date) -> list[date]:
    """Todas las fechas de cupón entre start y end (inclusive)."""
    dates = []
    year = start.year
    while year <= end.year + 1:
        for m in sorted(months):
            try:
                d = date(year, m, day)
            except ValueError:
                continue
            if start <= d <= end:
                dates.append(d)
        year += 1
    return sorted(dates)


def bond_calendar(symbol: str, from_date: date | None = None) -> list[dict]:
    """Calendario de pagos futuros de un bono soberano por cada 100 VN."""
    data = _load()
    bond = _resolve(symbol, data)
    if not bond:
        return []

    start = from_date or date.today()
    amorts = {a["fecha"]: a["pct"] for a in bond.get("amort", [])}
    all_amort_dates = sorted(amorts.keys())
    if not all_amort_dates:
        return []
    last_date = datetime.strptime(all_amort_dates[-1][:10], "%Y-%m-%d").date()

    months = bond.get("coupon_months", [1, 7])
    day = bond.get("coupon_day", 9)
    schedule = bond.get("coupon_schedule", [])

    # Capital residual: arranca en 100 y baja con cada amortización pasada
    residual = 100.0
    for fecha_str in all_amort_dates:
        fd = datetime.strptime(fecha_str[:10], "%Y-%m-%d").date()
        if fd < start:
            residual -= amorts[fecha_str] * 100.0 / 100.0

    coupon_dates = _coupon_dates(months, day, start, last_date)
    events = []
    for cd in coupon_dates:
        # Tasa vigente (anual) → cupón semestral sobre residual vivo
        annual = _rate_at(schedule, cd)
        interest = residual * annual / len(months)
        cd_str = cd.isoformat()
        principal = 0.0
        if cd_str in amorts:
            principal = amorts[cd_str]
            residual = max(0.0, residual - principal)
        if interest <= 0 and principal <= 0:
            continue
        kind = ("Cupón + amortización" if principal and interest
                else "Amortización" if principal else "Cupón")
        events.append({
            "date": cd_str,
            "symbol": symbol,
            "name": bond.get("name"),
            "law": bond.get("law"),
            "kind": kind,
            "interest": round(interest, 4),
            "principal": round(principal, 4),
            "amount": round(interest + principal, 4),
            "residual": round(residual, 4),
            "currency": bond.get("currency", "USD"),
        })
    return events


def all_bonds() -> list[str]:
    return list(_load().keys())


def simulate(symbol: str, amount: float, price: float,
             currency_amount: str = "USD") -> dict:
    """Simula una inversión en un bono soberano.

    Dado un monto a invertir y el precio limpio (por 100 VN), calcula:
      - cuántos nominales compra
      - el flujo de fondos completo escalado a esa tenencia
      - total a cobrar, desglosado en renta (cupones) y amortización (capital)
      - fecha del próximo cobro y del último

    amount: monto a invertir (en la moneda del precio, normalmente USD).
    price: precio limpio por 100 VN (ej. 72.5).
    """
    data = _load()
    bond = _resolve(symbol, data)
    if not bond:
        return {"ok": False, "error": f"Bono {symbol} sin flujos curados."}
    if not price or price <= 0:
        return {"ok": False, "error": "Precio inválido."}
    if not amount or amount <= 0:
        return {"ok": False, "error": "Monto inválido."}

    # Nominales que compra: cada 100 VN cuesta `price`, así que
    # VN = monto / precio * 100
    nominales = amount / price * 100.0
    factor = nominales / 100.0  # escala del flujo (que está por 100 VN)

    flows = bond_calendar(symbol)
    schedule = []
    total_interest = 0.0
    total_principal = 0.0
    for f in flows:
        interest = f["interest"] * factor
        principal = f["principal"] * factor
        total_interest += interest
        total_principal += principal
        schedule.append({
            "date": f["date"],
            "kind": f["kind"],
            "interest": round(interest, 2),
            "principal": round(principal, 2),
            "amount": round(interest + principal, 2),
            "currency": f.get("currency", "USD"),
        })

    total_cobros = total_interest + total_principal
    return {
        "ok": True,
        "symbol": symbol,
        "name": bond.get("name"),
        "law": bond.get("law"),
        "currency": bond.get("currency", "USD"),
        "invested": round(amount, 2),
        "price": price,
        "nominales": round(nominales, 2),
        "total_to_collect": round(total_cobros, 2),
        "total_interest": round(total_interest, 2),
        "total_principal": round(total_principal, 2),
        "total_return": round(total_cobros - amount, 2),
        "return_pct": round((total_cobros / amount - 1) * 100, 2) if amount else None,
        "next_payment": schedule[0] if schedule else None,
        "last_payment": schedule[-1] if schedule else None,
        "payments_count": len(schedule),
        "schedule": schedule,
    }


def payment_calendar(from_date: str = "", limit: int = 200) -> list[dict]:
    """Calendario consolidado de todos los soberanos, ordenado por fecha."""
    start = date.today()
    if from_date:
        try:
            start = datetime.strptime(from_date[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    events = []
    for sym in _load():
        events.extend(bond_calendar(sym, from_date=start))
    events.sort(key=lambda e: e["date"])
    return events[:limit]
