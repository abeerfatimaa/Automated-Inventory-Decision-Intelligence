# Intelligent Inventory Decision System — Project Description

## Overview

**Intelligent Inventory Decision System** is a full-stack, production-deployed web application that provides small and medium enterprises (SMEs) in retail, grocery, pharmacy, and distribution sectors with real-time, data-driven inventory intelligence. The platform delivers automated stock risk scoring, demand trend analysis, reorder recommendations, and anomaly detection — entirely through deterministic SQL algorithms with no paid ML APIs.

| | |
|---|---|
| **Author** | Abeer Fatima |
| **Frontend** | https://intelligent-inventory.vercel.app |
| **API** | https://intelligent-inventory.onrender.com |
| **API Docs** | https://intelligent-inventory.onrender.com/docs |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI 0.115, Uvicorn 0.30 |
| Database | PostgreSQL on Neon (serverless, AWS us-east-1) |
| DB Driver | psycopg 3.2 (async, connection pool) |
| Auth | JWT via python-jose (HS256, 24h expiry) |
| Frontend | React 19, Vite 7 |
| Charts | Chart.js 4.5 + react-chartjs-2 |
| HTTP Client | Axios 1.13 |
| PDF Export | jsPDF 4.2 + jspdf-autotable |
| Hosting | Render (backend), Vercel (frontend) |

---

## Directory Structure

```
Automated-Inventory-Decision-Intelligence/
├── README.md
├── ARCHITECTURE.md
├── ALGORITHMS.md
├── API.md
├── database_schema.sql          # PostgreSQL schema: tables, views, AI views
├── backend/
│   ├── main.py                  # FastAPI app — 20 endpoints (457 lines)
│   ├── database.py              # Connection pool setup
│   └── auth.py                  # JWT middleware
└── frontend/
    ├── vite.config.js
    ├── vercel.json
    └── src/
        ├── App.jsx              # Main React app — 6 tabs (1000 lines)
        └── App.css              # Dark theme styles (600+ lines)
```

---

## Data Model

### OLTP Tables (Write Layer)

#### `suppliers`
| Column | Type | Notes |
|---|---|---|
| supplier_id | SERIAL PK | |
| name | VARCHAR(150) | NOT NULL |
| contact_email | VARCHAR(150) | |
| phone | VARCHAR(50) | |

#### `products`
| Column | Type | Notes |
|---|---|---|
| product_id | SERIAL PK | |
| name | VARCHAR(150) | NOT NULL |
| category | VARCHAR(100) | Indexed |
| cost_price | NUMERIC(10,2) | NOT NULL |
| selling_price | NUMERIC(10,2) | NOT NULL |
| stock_quantity | INTEGER | DEFAULT 0 |
| reorder_level | INTEGER | DEFAULT 10 |
| supplier_id | INTEGER | FK → suppliers |

#### `sales`
| Column | Type | Notes |
|---|---|---|
| sale_id | SERIAL PK | |
| product_id | INTEGER | FK → products |
| quantity | INTEGER | CHECK > 0 |
| sale_price | NUMERIC(10,2) | |
| sale_date | DATE | Indexed |

#### `purchases`
Schema-level table for restocking records. Cascade-deleted when a product is removed, but there is no `POST /purchases` endpoint in the current API — the table is not populated by the backend.
| Column | Type | Notes |
|---|---|---|
| purchase_id | SERIAL PK | |
| product_id | INTEGER | FK → products |
| quantity | INTEGER | CHECK > 0 |
| purchase_price | NUMERIC(10,2) | |
| purchase_date | DATE | Indexed |

#### `stock_movements`
Schema-level audit trail table. Defined in the schema and cascade-deleted when a product is removed, but the current API does not write to it — no INSERT is issued on sales or purchases.
| Column | Type | Notes |
|---|---|---|
| movement_id | SERIAL PK | |
| product_id | INTEGER | FK → products |
| movement_type | VARCHAR(20) | `'SALE'` or `'PURCHASE'` |
| quantity | INTEGER | NOT NULL |
| movement_date | DATE | Indexed |

---

### OLAP Views (Read / Analytics Layer)

| View | Purpose |
|---|---|
| `monthly_sales_summary` | Pre-aggregated monthly revenue and units sold |
| `product_profitability` | Products ranked by gross profit and margin % |
| `inventory_turnover` | Fast/Moderate/Slow classification per product |
| `low_stock_report` | Products at or below reorder level with supplier info |
| `ai_insights` | Core intelligence: risk score, trend, days until stockout |
| `reorder_suggestions` | IntelliReorder™ — products at reorder level with recommended quantities and estimated costs (no supplier join) |
| `ai_budget_summary` | Aggregate reorder budget across all triggered products |

---

## Business Logic & Decision Rules

All intelligence is implemented as **deterministic SQL formulas** — fully explainable, no ML models required.

---

### Rule 1 — Stockout Risk Score (0–100)

**Purpose:** Quantify how urgently a product needs to be reordered.

```sql
risk_score = GREATEST(0, LEAST(100,
    (1 - (stock_quantity / (avg_daily_sales * 14))) * 100
))
```

**14-day window breakdown:**
- 5 days — supplier lead time
- 3 days — safety buffer for demand spikes
- 6 days — action margin before critical

**Risk Level Classification:**

| Score Range | Level | Action |
|---|---|---|
| 70–100 | Critical | Immediate reorder required |
| 40–69 | High | Monitor closely, plan reorder |
| 1–39 | Medium | Normal management |
| 0 | Safe | Well-stocked |

**Edge case:** If `avg_daily_sales = 0`, score = 0 (product not moving — no stockout risk).

---

### Rule 2 — Demand Trend Classification

**Purpose:** Detect meaningful directional shifts in customer demand.

**Window:** Last 30 days vs. days 31–60 (prior period).

```
current_avg  = SUM(qty) / COUNT(DISTINCT sale_dates)   [last 30 days from most recent sale]
previous_avg = SUM(qty) / COUNT(DISTINCT sale_dates)   [days 31–60 back from most recent sale]

Rising    → current_avg > previous_avg × 1.20   (+20% threshold)
Declining → current_avg < previous_avg × 0.80   (−20% threshold)
Stable    → otherwise
```

The ±20% threshold filters normal day-to-day variance — only meaningful shifts are surfaced.

---

### Rule 3 — IntelliReorder™ Recommended Quantity

**Purpose:** Calculate how many units to order when stock hits the reorder level.

**Trigger:** `stock_quantity ≤ reorder_level`

```sql
recommended_qty  = CEIL(avg_daily_sales × 8)
estimated_cost   = recommended_qty × cost_price
```

**8-day coverage breakdown:**
- 5 days — supplier lead time
- 3 days — safety stock buffer

`CEIL()` ensures no fractional units. `avg_daily_sales` = total qty sold in last 30 days ÷ COUNT(DISTINCT sale dates in that window).

**Example:** avg_daily_sales = 12 → recommended_qty = CEIL(96) = 96 units.

---

### Rule 4 — Inventory Turnover Classification

**Purpose:** Identify fast-moving vs. slow-moving / deadstock products.

```
turnover_ratio = total_units_sold / current_stock_quantity
```

| Ratio | Classification |
|---|---|
| > 10 | Fast Moving |
| 4–10 | Moderate |
| ≤ 4 | Slow Moving |
| stock = 0 | Out of Stock |

---

### Rule 5 — Anomaly Detection

**Purpose:** Flag products with unusual demand spikes or drops for investigation.

**Windows:**
- **Recent:** last 7 days (total qty ÷ 7)
- **Baseline:** days 8–37 back from the most recent sale date (total qty ÷ 30)

```sql
recent_avg   = SUM(qty WHERE sale_date > latest - 7 days)  / 7
baseline_avg = SUM(qty WHERE sale_date BETWEEN latest - 37 days
                                          AND latest - 8 days) / 30

-- Anomaly classification (ratio-based):
Spike → recent_avg / baseline_avg > 1.5   (50%+ increase)
Drop  → recent_avg / baseline_avg < 0.5   (50%+ decrease)

-- Zero-value edge cases:
Spike → baseline_avg = 0 AND recent_avg > 0
Drop  → recent_avg = 0   AND baseline_avg > 0
```

Filter: `ABS(recent_avg / baseline_avg - 1) > 0.5`

Results are ordered by absolute ratio deviation (descending), limited to the **top 20 anomalies**.

---

### Rule 6 — Days Until Stockout

**Purpose:** Provide a concrete countdown to stock exhaustion.

```sql
days_until_stockout = stock_quantity / NULLIF(avg_daily_sales, 0)
```

Returns `NULL` when `avg_daily_sales = 0` (no meaningful prediction possible).

---

## API Endpoints (20 Total)

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns JWT (public) |

### Dashboard
| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard` | KPI summary (revenue, profit, alerts) |
| GET | `/sales/monthly` | Monthly sales aggregation |
| GET | `/sales/monthly-profit` | Monthly revenue vs gross profit |

### Products
| Method | Endpoint | Description |
|---|---|---|
| GET | `/products` | All products with supplier info |
| GET | `/products/{id}` | Single product |
| POST | `/products` | Create product |
| PUT | `/products/{id}` | Update product |
| DELETE | `/products/{id}` | Delete product (cascades to sales, purchases) |
| GET | `/products/{id}/history` | Monthly sales drill-down |
| GET | `/products/profitability` | Products ranked by gross profit (`start_date`, `end_date` optional) |

### Inventory
| Method | Endpoint | Description |
|---|---|---|
| GET | `/inventory/turnover` | Fast/Moderate/Slow classification |
| GET | `/inventory/low-stock` | Products at or below reorder level |
| POST | `/sales` | Record a sale (decrements stock) |

### Suppliers
| Method | Endpoint | Description |
|---|---|---|
| GET | `/suppliers` | All suppliers |

### AI Intelligence
| Method | Endpoint | Description |
|---|---|---|
| GET | `/ai/insights` | Risk scores, demand trends, days until stockout |
| GET | `/ai/budget` | Total estimated reorder budget |
| GET | `/ai/anomalies` | Top 20 demand anomaly alerts |
| GET | `/reorder` | IntelliReorder™ suggestions |

All GET endpoints except `/` and `/auth/login` require `Authorization: Bearer <token>`.

---

## Caching Strategy

- **Type:** In-memory Python dict with TTL
- **TTL:** 60 seconds per endpoint
- **Cache key:** Endpoint path + query parameters
- **Invalidation:** Any POST / PUT / DELETE clears the entire cache

**Cached endpoints:** `/dashboard`, `/products` (list), `/products/profitability`, `/inventory/turnover`, `/inventory/low-stock`, `/sales/monthly`, `/sales/monthly-profit`, `/reorder`, `/ai/insights`, `/ai/budget`, `/ai/anomalies`, `/suppliers`

**Not cached:** `GET /products/{id}` and `GET /products/{id}/history` (always hit the database directly)

**Benefit:** Sub-100ms response times on cache hit; protects serverless database from connection exhaustion.

---

## Authentication & Security

- **Algorithm:** JWT HS256, 24-hour expiry
- **Default credentials:** `admin` / `admin123` (change in production)
- **Public paths:** `/` and `/auth/login` only
- **Middleware:** All other requests require `Authorization: Bearer <token>`
- **CORS:** Currently open (`*`) — restrict to frontend domain in production
- **SQL injection:** Prevented via parameterized queries (psycopg)
- **Input validation:** Pydantic models on all POST/PUT payloads

---

## Frontend Dashboard Tabs

### 1. Overview
KPI cards (revenue, profit, margin, low-stock alerts), inventory movement doughnut, demand trend doughnut, risk distribution doughnut, monthly revenue vs profit bar chart.

### 2. Profitability
Product table sorted by gross profit, top-8 horizontal bar chart, CSV export, click-to-drill-down monthly history modal (dual-axis line chart).

### 3. Inventory
Turnover classification columns (Fast / Moderate / Slow), low stock alert cards with supplier contact, CSV export.

### 4. Stockout Risk
Risk table with risk score progress bars (0–100), demand trend badges (▲ ▼ ●), days until stockout, recommended reorder quantity, CSV export.

### 5. Reorder (IntelliReorder™)
Reorder table with recommended quantity and estimated cost per product; supplier summary cards (populated from cross-referencing product data); CSV and PDF (Purchase Order) export grouped by supplier.

### 6. Anomaly Alerts
Top-20 anomaly cards (Spike / Drop), change %, recent vs baseline averages, category and type filtering, drill-down modal.

---

## Sale Recording Flow

```
POST /sales { product_id, quantity, sale_price, sale_date }
    ↓
Validate: product exists, stock >= quantity
    ↓
INSERT into sales
UPDATE products SET stock_quantity = stock_quantity - quantity
    ↓
Bust entire cache
    ↓
Next GET requests return freshly computed analytics
```

---

## Deployment Architecture

```
User Browser
    │
    ▼
Vercel CDN (React SPA)          ← npm run build → dist/
    │  Authorization: Bearer <token>
    ▼
Render (FastAPI / Uvicorn)      ← git push auto-deploy
    │  psycopg connection pool (2–10)
    ▼
Neon PostgreSQL (AWS us-east-1) ← SSL enforced
```

**Cold starts:** Render free tier cold-starts ~30s after 15 min inactivity.

---

## Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Neon PostgreSQL connection string |
| `SECRET_KEY` | No | `intellibizai-dev-secret-...` | Change in production |
| `AUTH_USERNAME` | No | `admin` | Change in production |
| `AUTH_PASSWORD` | No | `admin123` | Change in production |
| `VITE_API_URL` | Frontend | `http://localhost:8000` | Set to Render URL in production |

---

## Known Limitations

| Limitation | Notes |
|---|---|
| No real-time updates | Dashboard requires manual refresh (no WebSocket) |
| Free-tier cold starts | Render backend sleeps after 15 min inactivity |
| No bulk operations | Products and sales added one at a time |
| No audit logging | No record of who changed what |
| No mobile optimization | Designed for desktop/tablet |
| No role-based access | Single admin user only |
| No rate limiting | Not implemented on free tier |

---

## Quick Start

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install fastapi uvicorn psycopg python-jose python-dotenv pandas
echo "DATABASE_URL=postgresql://..." > .env
python -m uvicorn main:app --reload

# Frontend
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev

# Database
# Create Neon instance → paste connection string → run database_schema.sql
```

---

## Core Design Principles

1. **Transparent algorithms** — every score and recommendation is traceable to a SQL formula, no black-box ML.
2. **OLTP + OLAP separation** — write to normalized tables; read from pre-computed analytical views.
3. **Cache-first reads** — 60s TTL cache protects the database and delivers fast responses.
4. **Cascade-safe deletes** — product deletion cleans up all linked transactions.
5. **Edge-case safety** — `NULLIF`, `GREATEST(0,...)`, `LEAST(100,...)` prevent division-by-zero and out-of-range scores.
