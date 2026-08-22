"""
data/ons_static.py — Condiciones de emisión de ONs + calendario de pagos.

Las condiciones de emisión (cupón, frecuencia, amortización, vencimiento) son
FIJAS: vienen del prospecto de cada ON y no cambian. Las guardamos en
ons_flows.json y las cruzamos con el precio en vivo de BYMA para alimentar
la calculadora de TIR/duration.

Esto reemplaza la extracción por regex sobre PDFs (frágil) por datos curados
y confiables, y permite armar el calendario de próximos cortes de cupón y
amortizaciones sin depender de scraping.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from . import bonds

_FLOWS_PATH = Path(__file__).resolve().parent / "ons_flows.json"


def _load() -> dict:
    try:
        with open(_FLOWS_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("ons", {})
    except Exception:
        return {}


def emission_terms(symbol: str) -> dict | None:
    """Condiciones de emisión de una ON por su símbolo base (sin sufijo D/C).

    Acepta tanto 'YMCXO' como 'YMCXD' o 'YMCXC' — normaliza al símbolo base.
    """
    data = _load()
    sym = (symbol or "").upper()
    # Buscar exacto primero
    if sym in data:
        return {"symbol": sym, **data[sym]}
    # Probar quitando sufijo de moneda (D=USD, C=CCL)
    for suffix in ("D", "C", "O"):
        if sym.endswith(suffix) and sym[:-1] + "O" in data:
            base = sym[:-1] + "O"
            return {"symbol": base, **data[base]}
    return None


def list_terms() -> list[dict]:
    """Todas las ONs con condiciones de emisión conocidas."""
    return [{"symbol": sym, **terms} for sym, terms in _load().items()]


def _ccy_group(ccy: str) -> str:
    """Agrupa las monedas de BYMA/prospecto en dólar vs peso. Las especies D
    (USD) y C (EXT/CCL) son ambas denominación dólar; O es pesos."""
    c = (ccy or "").upper()
    if c in ("USD", "US$", "U$S", "EXT", "CCL", "D", "C", "DOLARES", "DÓLARES"):
        return "USD"
    if c in ("ARS", "PESOS", "$", "O"):
        return "ARS"
    return c


def _base_root(symbol: str) -> str:
    """Raíz de la ON sin el sufijo de especie/moneda (O=ARS, D=USD, C=EXT)."""
    sym = (symbol or "").upper().split(".")[0]
    if sym and sym[-1] in {"O", "D", "C"}:
        return sym[:-1]
    return sym


def _price_by_root(byma_rows: list[dict]) -> dict[str, dict[str, float]]:
    """Índice raíz → {grupo_moneda → precio} con los precios en vivo de BYMA.

    Sirve para derivar el CCL implícito de la propia ON (precio_ARS / precio_USD)
    cuando ambas patas operaron, sin depender del CCL de mercado."""
    out: dict[str, dict[str, float]] = {}
    for row in byma_rows:
        price = row.get("price") or 0
        if price <= 0:
            continue
        root = _base_root(row.get("symbol") or "")
        grp = _ccy_group(row.get("currency"))
        out.setdefault(root, {})[grp] = float(price)
    return out


def enrich_with_terms(byma_rows: list[dict], ccl: float | None = None) -> list[dict]:
    """Cruza filas de BYMA (precio en vivo) con las condiciones de emisión.

    Para cada ON de BYMA que tengamos en ons_flows.json, agrega cupón real,
    frecuencia y amortización. La TIR/duration se calcula sobre la especie cuya
    moneda coincide con la del prospecto. Además, para las ONs en dólares cuya
    pata USD (D) no operó pero sí opera la especie en pesos (O), sintetiza un
    precio en dólares = precio_ARS / CCL y calcula igual la TIR en dólares. El
    CCL usado es el implícito de la propia ON (precio_ARS / precio_USD) si ambas
    patas cotizan, y si no, el `ccl` de mercado que se pase por parámetro.
    """
    price_index = _price_by_root(byma_rows)
    out = []
    for row in byma_rows:
        sym = (row.get("symbol") or "").upper()
        terms = emission_terms(sym)
        if not terms:
            out.append(row)
            continue

        merged = {
            **row,
            "issuer": terms.get("issuer") or row.get("issuer"),
            "name": terms.get("name"),
            "coupon_rate": terms.get("coupon_rate"),
            "coupon_pct": round((terms.get("coupon_rate") or 0) * 100, 3),
            "frequency": terms.get("frequency"),
            "maturity": terms.get("maturity"),
            "amort_start": terms.get("amort_start"),
            "amort_count": terms.get("amort_count", 1),
            "amortization_type": ("bullet" if int(terms.get("amort_count", 1)) <= 1 else "partial"),
            "amortization_label": ("Bullet" if int(terms.get("amort_count", 1)) <= 1
                                   else f"{int(terms.get('amort_count', 1))} cuotas"),
            "law": terms.get("law"),
            "has_terms": True,
        }

        # TIR solo si la moneda de la especie coincide con la del prospecto.
        price = row.get("price") or 0
        same_ccy = _ccy_group(row.get("currency")) == _ccy_group(terms.get("currency"))
        merged["tir_applicable"] = same_ccy
        if same_ccy and price > 0 and terms.get("coupon_rate") and terms.get("maturity"):
            calc = bonds.analyze(
                price=float(price),
                coupon_rate=float(terms["coupon_rate"]),
                frequency=int(terms.get("frequency", 2)),
                maturity=terms["maturity"],
                amort_start=terms.get("amort_start"),
                amort_count=int(terms.get("amort_count", 1)),
                currency=terms.get("currency"),
                symbol=sym,
            )
            if calc.get("ok"):
                merged["tir_pct"] = calc.get("tir_pct")
                merged["modified_duration"] = calc.get("modified_duration_years")
                merged["parity"] = calc.get("parity")
                merged["next_coupon"] = calc.get("next_coupon")
                merged["tir_source"] = "directo"

        # TIR vía CCL: prospecto en dólares, especie en pesos con precio. Se
        # convierte el precio ARS a USD para poder calcular la TIR en dólares
        # (la única con sentido para una ON hard-dollar). Útil sobre todo cuando
        # la pata D no operó y sólo hay precio en la especie en pesos.
        elif (not same_ccy and price > 0
              and _ccy_group(terms.get("currency")) == "USD"
              and _ccy_group(row.get("currency")) == "ARS"
              and terms.get("coupon_rate") and terms.get("maturity")):
            root = _base_root(row.get("symbol") or "")
            pair = price_index.get(root) or {}
            on_ccl = None
            if pair.get("ARS") and pair.get("USD"):
                try:
                    on_ccl = pair["ARS"] / pair["USD"]
                except ZeroDivisionError:
                    on_ccl = None
            eff_ccl = on_ccl or ccl
            if eff_ccl and eff_ccl > 0:
                usd_price = float(price) / float(eff_ccl)
                calc = bonds.analyze(
                    price=usd_price,
                    coupon_rate=float(terms["coupon_rate"]),
                    frequency=int(terms.get("frequency", 2)),
                    maturity=terms["maturity"],
                    amort_start=terms.get("amort_start"),
                    amort_count=int(terms.get("amort_count", 1)),
                    currency="USD",
                    symbol=sym,
                )
                if calc.get("ok"):
                    merged["tir_applicable"] = True
                    merged["tir_pct"] = calc.get("tir_pct")
                    merged["modified_duration"] = calc.get("modified_duration_years")
                    merged["parity"] = calc.get("parity")
                    merged["next_coupon"] = calc.get("next_coupon")
                    merged["tir_source"] = "ccl_propio" if on_ccl else "ccl_mercado"
                    merged["ccl_used"] = round(float(eff_ccl), 2)
                    merged["synthetic_usd_price"] = round(usd_price, 4)

        out.append(merged)
    return out


def payment_calendar(from_date: str = "", months_ahead: int = 12) -> list[dict]:
    """Calendario de próximos cortes de cupón y amortizaciones.

    Para cada ON conocida, arma su flujo de fondos futuro y devuelve los pagos
    ordenados por fecha. Cada evento indica emisor, tipo (cupón/amortización),
    y monto por cada 100 de VN.
    """
    from datetime import datetime
    start = date.today()
    if from_date:
        try:
            start = datetime.strptime(from_date[:10], "%Y-%m-%d").date()
        except ValueError:
            pass

    events = []
    for sym, terms in _load().items():
        if not terms.get("coupon_rate") or not terms.get("maturity"):
            continue
        flows = bonds.build_cashflow(
            coupon_rate=float(terms["coupon_rate"]),
            frequency=int(terms.get("frequency", 2)),
            maturity=terms["maturity"],
            settlement=start,
            amort_start=terms.get("amort_start"),
            amort_count=int(terms.get("amort_count", 1)),
        )
        for f in flows:
            fd = f["date"] if hasattr(f["date"], "isoformat") else f["date"]
            interest = f.get("interest", 0)
            principal = f.get("principal", 0)
            if principal > 0 and interest > 0:
                kind = "Cupón + amortización"
            elif principal > 0:
                kind = "Amortización"
            else:
                kind = "Cupón"
            events.append({
                "date": fd.isoformat() if hasattr(fd, "isoformat") else str(fd),
                "symbol": sym,
                "issuer": terms.get("issuer"),
                "name": terms.get("name"),
                "kind": kind,
                "interest": round(interest, 4),
                "principal": round(principal, 4),
                "amount": round(interest + principal, 4),
                "currency": terms.get("currency", "USD"),
            })

    events.sort(key=lambda e: e["date"])
    return events
