# Calce — Tesorería PyME

Herramienta de tesorería para PyMEs: proyecta el flujo de caja diario, detecta
el excedente y lo invierte en instrumentos reales (FCI, bonos, ONs).

## Cómo correr

```bash
pip install -r requirements.txt
python3 app.py
# o: uvicorn app:app --port 8500
```

Abrir http://localhost:8500

## Qué hace

### Flujo de caja
Cargás saldo inicial, colchón mínimo, horizonte y movimientos (manuales o
importados de Excel/CSV). Proyecta el saldo día a día y detecta el excedente
colocable: lo máximo que podés invertir sin perforar el colchón en todo el
horizonte. Muestra alertas de descubierto.

### Importar Excel/CSV
Botón "Importar" en Movimientos. Detecta columnas de fecha, concepto y monto
(o entradas/salidas) por nombre. Soporta formato de números argentino.

### Excedente
Muestra el excedente y las opciones según liquidez y riesgo.

### Inversiones
Coloca el excedente en instrumentos reales:
- **FCI Money Market**: rendimientos reales de CAFCI, ordenados por TNA.
  Liquidez inmediata (T+0). La estrella para tesorería.
- **Bonos soberanos** (AL/GD): simula el flujo de cobros completo.
- **ONs**: obligaciones negociables con flujos curados.
- **Caución bursátil**: tasa del Índice BYMA a 1 día, con curva por plazos.
- **Plazo fijo**: tasas por banco desde la API del BCRA (Régimen de Transparencia).

Para cada uno muestra cuánto y cuándo cobrás.

## Módulos

- `data/cashflow.py` — motor de proyección diaria
- `data/fci.py` — FCI money market desde CAFCI
- `data/tasas.py` — caución (BYMA) y plazo fijo (BCRA)
- `data/importer.py` — importar Excel/CSV
- `data/sovereign_static.py`, `ons_static.py`, `bonds.py` — renta fija (de Hormiga)
- `data/bymadata.py`, `data912.py` — precios de mercado

## Fuentes de datos (requieren internet en el servidor)

- **CAFCI** (api.cafci.org.ar): rendimientos de FCI. Si no responde, usa tasas
  de referencia.
- **BYMA / data912**: precios de bonos y ONs.

Los flujos de bonos (cupones, amortizaciones) son curados, de los prospectos.

### Impuestos
Estimador de IVA, IIBB, Ganancias e impuesto al cheque a partir de las ventas y
compras. Distingue operaciones en efectivo vs banco (clave para PyMEs con mucho
efectivo). Proyecta los vencimientos y los lleva al flujo de caja. Es orientativo,
no reemplaza al contador.

## Próxima etapa

- Chatbot asesor que guíe la decisión de inversión según el perfil y el horizonte.
