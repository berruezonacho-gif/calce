"""
data/renta_fija.py — Boards de bonos argentinos estilo bonistas.

Une los feeds de BYMA (public-bonds + lebacs), clasifica por familia,
agrupa las especies por moneda (base=ARS 24hs, D=USD, C=CABLE) y calcula
métricas por bono: TIR, TEM, TNA, MD, paridad, VT.

Familias:
  soberanos_ar  AL29/30/35/41, AE38 (ley Argentina)
  soberanos_ny  GD29/30/35/38/41/46 (ley Nueva York)
  bopreal       BPA7/BPB7/BPC7/BPD7/BPA8/BPB8... (BCRA)
  dollar_linked TZV27/28, D31L6...
  lecaps        S.. (letras capitalizables, ARS)
  boncaps       T15E7/T30A7/T31Y7/T30J7/TO26 (bonos capitalizables, ARS)
  lecer         X.. (letras CER)

Los soberanos usan sovereign_static (flujos del canje 2020) para TIR real.
Los capitalizables usan lecaps_flows.json (valor final fijo de emisión).
BOPREAL / dólar-linked / LECER: precio, volumen, vencimiento y paridad
(TIR queda pendiente hasta curar sus términos — se marca tir=None).
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path

from . import bymadata, sovereign_static
from . import bonds

_LECAPS_PATH = Path(__file__).resolve().parent / "lecaps_flows.json"

_SOB_AR = re.compile(r"^(AL29|AL30|AL35|AE38|AL41)$")
_SOB_NY = re.compile(r"^(GD29|GD30|GD35|GD38|GD41|GD46)$")
_BOPREAL = re.compile(r"^BP[A-D]\d$")
_DL = re.compile(r"^(TZV\d{2}|D3\d[A-Z]\d)$")
_LECAP = re.compile(r"^S\d{2}[A-Z]\d$")
_BONCAP = re.compile(r"^(T\d{2}[A-Z]\d|TO\d{2})$")
_LECER = re.compile(r"^X\d{2}[A-Z]\d$")


def _load_caps() -> dict:
    try:
        return json.loads(_LECAPS_PATH.read_text()).get("capitalizables", {})
    except Exception:
        return {}


def _pick_price(row: dict):
    return bymadata._pick_price(row)


def _base_symbol(sym: str) -> tuple[str, str]:
    """(base, moneda) a partir del símbolo con sufijo de especie.
    base=ARS, D=USD, C=CABLE. Las variantes X/Y/Z (CI) se descartan."""
    s = sym.upper()
    if s.endswith("D") and len(s) >= 5:
        return s[:-1], "USD"
    if s.endswith("C") and len(s) >= 5:
        return s[:-1], "CABLE"
    return s, "ARS"


def _family(base: str) -> str | None:
    if _SOB_AR.match(base):
        return "soberanos_ar"
    if _SOB_NY.match(base):
        return "soberanos_ny"
    if _BOPREAL.match(base):
        return "bopreal"
    if _DL.match(base):
        return "dollar_linked"
    if _BONCAP.match(base):
        return "boncaps"
    if _LECAP.match(base):
        return "lecaps"
    if _LECER.match(base):
        return "lecer"
    return None


def _days_to(maturity: str) -> int | None:
    try:
        return (datetime.strptime(maturity[:10], "%Y-%m-%d").date() - date.today()).days
    except Exception:
        return None


def _cap_metrics(price: float, vf: float, days: int) -> dict:
    """Métricas de un capitalizable (cupón cero con valor final conocido)."""
    if not price or not vf or not days or days <= 0:
        return {}
    ratio = vf / price
    tir = ratio ** (365 / days) - 1
    tem = ratio ** (30 / days) - 1
    return {
        "tir_pct": round(tir * 100, 2),
        "tem_pct": round(tem * 100, 2),
        "tna_pct": round(tem * 12 * 100, 2),
        "md": round(days / 365, 2),
        "paridad_pct": round(price / vf * 100, 2),
        "vt": vf,
        "valor_final": vf,
    }


def _sovereign_metrics(base: str, price: float, currency: str) -> dict:
    """TIR/MD/paridad de un soberano usando su flujo real (canje 2020).
    Solo tiene sentido sobre las especies en dólares (D/C): el flujo es USD."""
    if currency == "ARS" or not price:
        return {}
    try:
        flows = sovereign_static.bond_calendar(base)
        if not flows:
            return {}
        # Un comprador de hoy liquida T+1: los pagos con fecha <= mañana ya no
        # le corresponden (el bono cotiza ex-cupón). Se excluyen del flujo.
        flows = [f for f in flows if (_days_to(f["date"]) or 0) > 1]
        if not flows:
            return {}
        # bonds._npv espera objetos date, no strings.
        flow_tuples = [(bonds._to_date(f["date"]), f["amount"]) for f in flows]
        y = bonds.tir(price, flow_tuples)
        if y is None:
            return {}
        dur = bonds.duration(price, flow_tuples, y)
        # VT (valor técnico) ≈ capital residual vigente. Si el próximo pago está
        # encima (ya cotiza ex-cupón), usamos el residual posterior.
        first = flows[0]
        d0 = _days_to(first["date"]) or 0
        residual_post = first.get("residual") or 0
        principal_next = first.get("principal") or 0
        vt = residual_post if d0 <= 3 else residual_post + principal_next
        if not vt:
            vt = 100.0
        return {
            "tir_pct": round(y * 100, 2),
            "tem_pct": round(((1 + y) ** (1 / 12) - 1) * 100, 2),
            "tna_pct": round(((1 + y) ** (1 / 12) - 1) * 12 * 100, 2),
            "md": round(dur["modified"], 2) if dur else None,
            "paridad_pct": round(price / vt * 100, 1) if vt else None,
            "vt": round(vt, 2),
        }
    except Exception:
        return {}


def boards(force: bool = False) -> dict:
    """Todos los boards por familia + dólares financieros.

    Cachea el último resultado bueno (con precios) y lo reutiliza como fallback
    cuando BYMA no responde o el mercado está cerrado (los bonos vendrían sin
    precio). Así la sección siempre muestra la última foto disponible.
    """
    from .cache import get_json_stale, set_json
    CACHE_KEY = "renta_fija_boards"

    pb = bymadata.public_bonds(force=force)
    lb = bymadata.lebacs(force=force)
    rows = (pb.get("rows") or []) + (lb.get("rows") or [])
    caps = _load_caps()

    # Agrupar especies por base
    by_base: dict[str, dict] = {}
    for r in rows:
        sym = (r.get("symbol") or "").upper()
        if not sym:
            continue
        base, ccy = _base_symbol(sym)
        fam = _family(base)
        if fam is None:
            continue
        slot = by_base.setdefault(base, {"base": base, "family": fam, "species": {}})
        # No pisar la base con una variante (p.ej. AL30 con AL30D->base AL30 ok)
        if ccy not in slot["species"]:
            slot["species"][ccy] = r

    families: dict[str, list] = {}
    dolares_al, dolares_gd = [], []

    for base, slot in sorted(by_base.items()):
        fam = slot["family"]
        sp = slot["species"]
        ars_row = sp.get("ARS") or {}
        usd_row = sp.get("USD") or {}
        cable_row = sp.get("CABLE") or {}
        p_ars = _pick_price(ars_row)
        p_usd = _pick_price(usd_row)
        p_cable = _pick_price(cable_row)
        maturity = (ars_row.get("maturityDate") or usd_row.get("maturityDate")
                    or cable_row.get("maturityDate") or "")[:10]
        days = None
        for r in (ars_row, usd_row, cable_row):
            if r.get("daysToMaturity"):
                days = r["daysToMaturity"]
                break
        if days is None and maturity:
            days = _days_to(maturity)

        # Precio y moneda "principal" del board según la familia
        if fam in ("soberanos_ar", "soberanos_ny", "bopreal"):
            main_price, main_ccy = (p_usd, "USD") if p_usd else ((p_cable, "CABLE") if p_cable else (p_ars, "ARS"))
        else:
            main_price, main_ccy = (p_ars, "ARS") if p_ars else ((p_usd, "USD") if p_usd else (p_cable, "CABLE"))

        item = {
            "ticker": base,
            "family": fam,
            "description": ars_row.get("securityDesc") or usd_row.get("securityDesc") or "",
            "price": main_price,
            "price_ccy": main_ccy,
            "price_ars": p_ars,
            "price_usd": p_usd,
            "price_cable": p_cable,
            "maturity": maturity,
            "days": days,
            "volume": (ars_row.get("volumeAmount") or 0) + (usd_row.get("volumeAmount") or 0) + (cable_row.get("volumeAmount") or 0),
            "vol_musd": round(((usd_row.get("volumeAmount") or 0) + (cable_row.get("volumeAmount") or 0)) / 1e6, 2),
        }

        # Métricas según familia
        if fam in ("soberanos_ar", "soberanos_ny"):
            item.update(_sovereign_metrics(base, main_price if main_ccy != "ARS" else None, main_ccy))
            # Dólares financieros: MEP/CCL del bono
            mep = (p_ars / p_usd) if (p_ars and p_usd) else None
            ccl = (p_ars / p_cable) if (p_ars and p_cable) else None
            fin = {"ticker": base, "pesos": p_ars, "dolar": p_usd, "cable": p_cable,
                   "mep": round(mep, 2) if mep else None, "ccl": round(ccl, 2) if ccl else None}
            (dolares_al if fam == "soberanos_ar" else dolares_gd).append(fin)
        elif fam in ("lecaps", "boncaps"):
            term = caps.get(base)
            if term and item["price"] and days:
                item.update(_cap_metrics(item["price"], term["valor_final"], days))
                item["has_terms"] = True
            else:
                item["has_terms"] = False

        families.setdefault(fam, []).append(item)

    for fam in families:
        families[fam].sort(key=lambda x: x.get("days") or 99999)

    # ¿El resultado tiene precios utilizables? Contamos bonos con precio.
    con_precio = sum(
        1 for fam in families.values() for b in fam if b.get("price")
    )
    result = {
        "ok": True,
        "source": "BYMADATA public-bonds + lebacs",
        "families": families,
        "dolares_financieros": {"al": dolares_al, "gd": dolares_gd},
        "counts": {k: len(v) for k, v in families.items()},
    }

    if con_precio >= 3:
        # Buen resultado: lo guardamos como última foto y lo devolvemos.
        set_json(CACHE_KEY, result)
        return result

    # Sin precios (mercado cerrado o BYMA caído): devolvemos la última foto buena.
    stale = get_json_stale(CACHE_KEY)
    if stale:
        stale = {**stale, "stale": True}
        return stale
    return result
