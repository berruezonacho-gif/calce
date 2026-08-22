"""
data/bcra.py — Variables de referencia del BCRA + dólares (estilo bonistas).

Fuentes (todas gratis, sin API key):
  - BCRA API v4: api.bcra.gob.ar/estadisticas/v4.0/monetarias/{id} (verify=False:
    la cadena de certificados del BCRA no valida con el bundle estándar).
  - DolarAPI: dolarapi.com (blue).
  - MEP/CCL propios: calculados con AL30/AL30D/AL30C de BYMA (renta_fija).

Variables BCRA (id → qué es):
  5=mayorista  27=inflación mensual  28=inflación interanual
  29=inflación esperada REM (mediana 12m)  30=CER  31=UVA  44=TAMAR  7=BADLAR
"""

from __future__ import annotations

from datetime import date, timedelta

import httpx

from .cache import get_json, set_json

_API = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias"

VARIABLES = {
    "mayorista": {"id": 5, "label": "Dolar Mayorista", "desc": "Tipo de cambio USD/ARS Mayorista", "unit": "$"},
    "inflacion_mensual": {"id": 27, "label": "Inflacion Mensual", "desc": "Variación mensual del IPC (INDEC)", "unit": "%"},
    "inflacion_interanual": {"id": 28, "label": "Inflacion Interanual", "desc": "Variación interanual del IPC (INDEC)", "unit": "%"},
    "inflacion_esperada": {"id": 29, "label": "Inflacion Esperada (REM)", "desc": "Expectativa próximos 12 meses – Mediana REM BCRA", "unit": "%"},
    "cer": {"id": 30, "label": "CER", "desc": "Coeficiente de Estabilización de Referencia – Ajuste por inflación", "unit": ""},
    "uva": {"id": 31, "label": "UVA", "desc": "Unidad de Valor Adquisitivo", "unit": "$"},
    "tamar": {"id": 44, "label": "TAMAR", "desc": "Tasa de plazos fijos mayoristas (TNA)", "unit": "%"},
    "badlar": {"id": 7, "label": "BADLAR", "desc": "Tasa de depósitos a plazo fijo mayoristas (+1M)", "unit": "%"},
}


def _series(var_id: int, points: int = 30) -> list[dict]:
    """Últimos N puntos de una serie BCRA: [{fecha, valor}] ascendente."""
    desde = (date.today() - timedelta(days=points * 12)).isoformat()
    r = httpx.get(f"{_API}/{var_id}", params={"desde": desde, "limit": 1000},
                  verify=False, timeout=25)
    r.raise_for_status()
    res = r.json().get("results", [])
    rows = res[0].get("detalle", []) if res and isinstance(res[0], dict) and "detalle" in res[0] else res
    rows = sorted(rows, key=lambda x: x.get("fecha") or "")
    return [{"fecha": x.get("fecha"), "valor": x.get("valor")} for x in rows][-points:]


def _dolarapi(casa: str) -> dict:
    try:
        r = httpx.get(f"https://dolarapi.com/v1/dolares/{casa}", timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception:
        return {}


def bandas_cambiarias(months_ahead: int = 12) -> list[dict]:
    """Bandas cambiarias post abril-2025: piso 1000 baja 1%/mes, techo 1400
    sube 1%/mes (fórmula pública del esquema)."""
    base = date(2025, 4, 14)
    out = []
    today = date.today()
    for k in range(months_ahead + 1):
        m = (today.year - base.year) * 12 + (today.month - base.month) + k
        y = today.year + (today.month - 1 + k) // 12
        mo = (today.month - 1 + k) % 12 + 1
        out.append({
            "fecha": f"{y}-{mo:02d}-01",
            "inferior": round(1000 * (0.99 ** m), 2),
            "superior": round(1400 * (1.01 ** m), 2),
        })
    return out


def variables(force: bool = False) -> dict:
    """Panel completo de variables de referencia. Cache 1h."""
    cache_key = "bcra_variables"
    if not force:
        cached = get_json(cache_key, 3600)
        if cached is not None:
            return cached

    from datetime import datetime
    out = {"ok": True, "source": "BCRA (actualizado cada hora) + DolarAPI + BYMA",
           "updated_at": datetime.now().isoformat(timespec="minutes"), "vars": {}}
    for key, meta in VARIABLES.items():
        try:
            serie = _series(meta["id"], points=30)
            last = serie[-1] if serie else {}
            prev = serie[-2] if len(serie) > 1 else {}
            out["vars"][key] = {
                **meta,
                "valor": last.get("valor"),
                "fecha": last.get("fecha"),
                "variacion": round((last.get("valor") or 0) - (prev.get("valor") or 0), 4) if prev else None,
                "serie": serie,
            }
        except Exception as e:
            out["vars"][key] = {**meta, "valor": None, "error": str(e)[:80]}

    # Dólares: blue de DolarAPI; MEP/CCL propios desde AL30 (BYMA).
    blue = _dolarapi("blue")
    out["blue"] = {"valor": blue.get("venta"), "compra": blue.get("compra"),
                   "fecha": (blue.get("fechaActualizacion") or "")[:10]}
    try:
        from . import renta_fija
        df = renta_fija.boards().get("dolares_financieros", {})
        al30 = next((b for b in df.get("al", []) if b["ticker"] == "AL30"), None)
        out["mep"] = {"valor": al30.get("mep") if al30 else None, "fuente": "AL30/AL30D BYMA"}
        out["ccl"] = {"valor": al30.get("ccl") if al30 else None, "fuente": "AL30/AL30C BYMA"}
    except Exception:
        out["mep"], out["ccl"] = {"valor": None}, {"valor": None}

    # Brechas vs mayorista
    may = (out["vars"].get("mayorista") or {}).get("valor")
    def brecha(v):
        return round((v / may - 1) * 100, 1) if (v and may) else None
    out["cotizaciones"] = [
        {"nombre": "Mayorista", "valor": may, "brecha": None, "color": "#e8544f"},
        {"nombre": "MEP", "valor": out["mep"]["valor"], "brecha": brecha(out["mep"]["valor"]), "color": "#41c98a"},
        {"nombre": "Blue", "valor": out["blue"]["valor"], "brecha": brecha(out["blue"]["valor"]), "color": "#4f8fe8"},
        {"nombre": "CCL", "valor": out["ccl"]["valor"], "brecha": brecha(out["ccl"]["valor"]), "color": "#e8a44f"},
    ]
    out["bandas"] = bandas_cambiarias(12)
    return set_json(cache_key, out)
