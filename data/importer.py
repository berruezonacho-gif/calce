"""
data/importer.py — Importar movimientos de flujo de caja desde Excel o CSV.

El tesorero suele tener sus cobranzas y pagos en una planilla. Este módulo lee
un archivo (xlsx o csv) y lo convierte en movimientos para la proyección.

Formato flexible: detecta columnas por nombre (fecha, concepto/detalle, monto o
entrada/salida). Acepta variantes comunes en español. Los montos pueden venir:
  - en una columna con signo (positivo=entra, negativo=sale), o
  - en dos columnas separadas (entradas / salidas / débito / crédito).

No requiere pandas: usa openpyxl para xlsx y el csv de la stdlib, para mantener
liviana la dependencia.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime


# Nombres de columna reconocidos (en minúscula, sin acentos)
_DATE_COLS = {"fecha", "date", "dia", "vencimiento", "fecha de pago", "f. pago"}
_LABEL_COLS = {"concepto", "detalle", "descripcion", "referencia", "nombre", "item", "glosa"}
_AMOUNT_COLS = {"monto", "importe", "amount", "valor", "total", "neto"}
_IN_COLS = {"entrada", "entradas", "ingreso", "ingresos", "credito", "credito", "haber", "cobros", "cobranza", "cobranzas"}
_OUT_COLS = {"salida", "salidas", "egreso", "egresos", "debito", "debito", "debe", "pagos", "pago"}
_REC_COLS = {"recurrencia", "recurrence", "repeticion", "frecuencia", "periodicidad"}
_ACCOUNT_COLS = {"cuenta", "account", "banco", "caja", "cuenta bancaria"}
_MEDIO_COLS = {"medio", "medio de pago", "medio de cobro", "forma de pago", "instrumento", "metodo"}


def _norm(s: str) -> str:
    s = (s or "").strip().lower()
    for a, b in [("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u")]:
        s = s.replace(a, b)
    return s


def _parse_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if hasattr(value, "isoformat"):  # date
        try:
            return value.isoformat()[:10]
        except Exception:
            pass
    s = str(value).strip()
    # dd/mm/aaaa o dd-mm-aaaa
    m = re.match(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})", s)
    if m:
        d, mo, y = m.groups()
        y = int(y)
        if y < 100:
            y += 2000
        try:
            return datetime(y, int(mo), int(d)).date().isoformat()
        except ValueError:
            return None
    # aaaa-mm-dd
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return s[:10]
    return None


def _parse_amount(value) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    # Sacar símbolo de moneda y espacios
    s = s.replace("$", "").replace(" ", "").replace("ARS", "")
    neg = s.startswith("(") and s.endswith(")")  # contabilidad: (123) = negativo
    s = s.strip("()")
    # Formato argentino: 1.234.567,89 → 1234567.89
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        val = float(s)
        return -val if neg else val
    except ValueError:
        return None


def _rows_from_xlsx(content: bytes) -> list[list]:
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise RuntimeError("openpyxl no está instalado. Ejecutá: pip install openpyxl")
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    return [list(row) for row in ws.iter_rows(values_only=True)]


def _rows_from_csv(content: bytes) -> list[list]:
    text = content.decode("utf-8-sig", errors="replace")
    # Detectar separador (coma o punto y coma)
    sample = text[:2000]
    sep = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=sep)
    return [row for row in reader]


def parse_movements(content: bytes, filename: str = "") -> dict:
    """Convierte el contenido de un archivo en movimientos de cash flow.

    Devuelve {"ok", "movements": [...], "skipped": n, "columns": {...}}.
    """
    name = (filename or "").lower()
    try:
        if name.endswith(".csv") or (b"," in content[:200] and not name.endswith((".xlsx", ".xls"))):
            rows = _rows_from_csv(content)
        else:
            rows = _rows_from_xlsx(content)
    except Exception as e:
        return {"ok": False, "error": f"No se pudo leer el archivo: {e}", "movements": []}

    if not rows or len(rows) < 2:
        return {"ok": False, "error": "El archivo está vacío o no tiene datos.", "movements": []}

    # Detectar la fila de encabezados (la primera con al menos 2 celdas de texto)
    header_idx = 0
    for i, row in enumerate(rows[:5]):
        texts = [c for c in row if isinstance(c, str) and c.strip()]
        if len(texts) >= 2:
            header_idx = i
            break
    headers = [_norm(str(c)) for c in rows[header_idx]]

    # Mapear columnas
    col_date = col_label = col_amount = col_in = col_out = col_rec = None
    col_account = col_medio = None
    for i, h in enumerate(headers):
        if col_date is None and h in _DATE_COLS: col_date = i
        if col_label is None and h in _LABEL_COLS: col_label = i
        if col_amount is None and h in _AMOUNT_COLS: col_amount = i
        if col_in is None and h in _IN_COLS: col_in = i
        if col_out is None and h in _OUT_COLS: col_out = i
        if col_rec is None and h in _REC_COLS: col_rec = i
        if col_account is None and h in _ACCOUNT_COLS: col_account = i
        if col_medio is None and h in _MEDIO_COLS: col_medio = i

    if col_date is None:
        return {"ok": False, "error": "No se encontró una columna de fecha. Asegurate de que tenga un encabezado como 'Fecha'.", "movements": []}
    if col_amount is None and col_in is None and col_out is None:
        return {"ok": False, "error": "No se encontró columna de monto. Usá 'Monto' (con signo) o 'Entradas'/'Salidas'.", "movements": []}

    movements = []
    skipped = 0
    for row in rows[header_idx + 1:]:
        if not row or all(c is None or c == "" for c in row):
            continue
        d = _parse_date(row[col_date]) if col_date < len(row) else None
        if not d:
            skipped += 1
            continue
        amount = None
        if col_amount is not None and col_amount < len(row):
            amount = _parse_amount(row[col_amount])
        if amount is None and (col_in is not None or col_out is not None):
            inflow = _parse_amount(row[col_in]) if (col_in is not None and col_in < len(row)) else 0
            outflow = _parse_amount(row[col_out]) if (col_out is not None and col_out < len(row)) else 0
            amount = (inflow or 0) - (outflow or 0)
        if amount is None or amount == 0:
            skipped += 1
            continue
        label = ""
        if col_label is not None and col_label < len(row) and row[col_label]:
            label = str(row[col_label]).strip()
        rec = "none"
        if col_rec is not None and col_rec < len(row) and row[col_rec]:
            rv = _norm(str(row[col_rec]))
            if rv in ("weekly", "semanal", "semana"): rec = "weekly"
            elif rv in ("quincenal", "quincena", "biweekly"): rec = "quincenal"
            elif rv in ("monthly", "mensual", "mes"): rec = "monthly"
            elif rv in ("quarterly", "trimestral", "trimestre"): rec = "quarterly"
            elif rv in ("daily", "diario", "dia"): rec = "daily"
        # Texto de cuenta y medio (el frontend los resuelve contra sus cuentas)
        account_text = ""
        if col_account is not None and col_account < len(row) and row[col_account]:
            account_text = str(row[col_account]).strip()
        medio = ""
        if col_medio is not None and col_medio < len(row) and row[col_medio]:
            mv = _norm(str(row[col_medio]))
            if "transfer" in mv: medio = "transferencia"
            elif "efectivo" in mv or "cash" in mv: medio = "efectivo"
            elif "cheque" in mv or "echeq" in mv: medio = "cheque"
            elif "tarjeta" in mv or "card" in mv: medio = "tarjeta"
        movements.append({
            "date": d,
            "amount": amount,
            "label": label,
            "recurrence": rec,
            "account_text": account_text,
            "medio": medio,
        })

    return {
        "ok": True,
        "movements": movements,
        "count": len(movements),
        "skipped": skipped,
        "columns": {
            "date": headers[col_date] if col_date is not None else None,
            "amount": headers[col_amount] if col_amount is not None else None,
            "in": headers[col_in] if col_in is not None else None,
            "out": headers[col_out] if col_out is not None else None,
        },
    }
