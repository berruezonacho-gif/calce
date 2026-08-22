"""
data/data912.py — Precios en vivo desde data912.com (API pública gratuita).

data912 es un API gratuito con precios del mercado argentino. Lo usamos como
fuente COMPLEMENTARIA de precios de ONs: cuando BYMA no tiene precio de una
especie (mercado cerrado, o especie de baja liquidez que no aparece en el
snapshot), data912 lo completa.

Endpoints relevantes (todos GET, sin auth):
  /live/arg_corp    → ONs corporativas en USD (~56 especies)
  /live/arg_bonds   → bonos soberanos en USD (AL/GD)
  /live/arg_notes   → LECAPs / letras
  /live/arg_cedears → CEDEARs
  /live/arg_stocks  → acciones

Cada fila trae al menos: symbol, c (close/último), q_op (operaciones), etc.

Los FLUJOS (cupones, amortizaciones) NO vienen de acá — siguen saliendo de los
JSON curados (ons_flows.json). data912 aporta únicamente el precio.

Nota: data912 puede tener delay respecto a BYMA. BYMA sigue siendo la fuente
primaria; data912 solo rellena huecos.
"""
from __future__ import annotations

import httpx

from .cache import get_json, set_json, get_json_stale

BASE = "https://data912.com"
TTL = 10 * 60  # 10 min, igual que el snapshot de BYMA

_ENDPOINTS = {
    "corp":    "/live/arg_corp",
    "bonds":   "/live/arg_bonds",
    "notes":   "/live/arg_notes",
    "cedears": "/live/arg_cedears",
    "stocks":  "/live/arg_stocks",
}


def _fetch(kind: str, force: bool = False) -> list[dict]:
    """Trae un endpoint de data912 y devuelve la lista de filas crudas."""
    path = _ENDPOINTS.get(kind)
    if not path:
        return []
    cache_key = f"data912_{kind}"
    if not force:
        cached = get_json(cache_key, TTL)
        if cached is not None:
            return cached

    try:
        r = httpx.get(f"{BASE}{path}", timeout=15,
                      headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        rows = r.json()
        if not isinstance(rows, list):
            rows = []
        set_json(cache_key, rows)
        return rows
    except Exception:
        stale = get_json_stale(cache_key)
        return stale or []


def _price_of(row: dict) -> float:
    """Extrae el precio de una fila de data912, probando los campos habituales."""
    for field in ("c", "close", "last", "px_bid", "price"):
        val = row.get(field)
        try:
            if val and float(val) > 0:
                return float(val)
        except (TypeError, ValueError):
            continue
    return 0.0


def prices_by_symbol(kind: str = "corp", force: bool = False) -> dict[str, float]:
    """{symbol → precio} para un tipo de instrumento.

    Para ONs corporativas usar kind='corp'. El símbolo se normaliza a mayúsculas.
    """
    out: dict[str, float] = {}
    for row in _fetch(kind, force=force):
        sym = (row.get("symbol") or row.get("ticker") or "").upper().strip()
        if not sym:
            continue
        price = _price_of(row)
        if price > 0:
            out[sym] = price
    return out


def ons_prices(force: bool = False) -> dict[str, float]:
    """Atajo: precios de ONs corporativas en USD desde data912."""
    return prices_by_symbol("corp", force=force)


def sovereign_prices(force: bool = False) -> dict[str, float]:
    """Atajo: precios de bonos soberanos en USD desde data912."""
    return prices_by_symbol("bonds", force=force)
