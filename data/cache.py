import json
import time
from pathlib import Path


CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "ar"


def get_json(name: str, ttl: int):
    path = CACHE_DIR / f"{name}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    if time.time() - payload.get("fetched_at", 0) > ttl:
        return None
    return payload.get("data")


def get_json_stale(name: str):
    path = CACHE_DIR / f"{name}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    return payload.get("data")


def find_json_stale(prefix: str):
    if not CACHE_DIR.exists():
        return None
    best = None
    best_count = -1
    for path in CACHE_DIR.glob(f"{prefix}*.json"):
        try:
            payload = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        data = payload.get("data")
        count = len(data) if isinstance(data, list) else 0
        if count > best_count:
            best = data
            best_count = count
    return best


def set_json(name: str, data):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError:
        return data
    path = CACHE_DIR / f"{name}.json"
    try:
        path.write_text(json.dumps({"fetched_at": time.time(), "data": data}, ensure_ascii=False))
    except OSError:
        # En entornos read-only devolvemos igual el dato fresco; el servidor
        # real sí puede persistir cache.
        pass
    return data
