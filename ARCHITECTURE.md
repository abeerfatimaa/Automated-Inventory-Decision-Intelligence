# Architecture & Data Flow

> [← Back to README](README.md)

---

## Table of Contents

- [System Overview](#system-overview)
- [From OLTP to OLAP](#from-oltp-to-olap)
- [Data Flow Examples](#data-flow-examples)
- [Caching Strategy](#caching-strategy)
- [Deployment Topology](#deployment-topology)

---

## System Overview

The platform is structured across three logical layers, each with a distinct responsibility:

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                   │
│                                                         │
│   React 19 SPA  ·  Chart.js  ·  6 Dashboard Tabs        │
│   CSV / PDF Export  ·  Dynamic Filters  ·  Drill-down   │
└────────────────────────┬────────────────────────────────┘
                         │  HTTPS
┌────────────────────────▼────────────────────────────────┐
│                      API LAYER                          │
│                                                         │
│   FastAPI (Render)                                      │
│   ├── 60s TTL In-Memory Cache                           │
│   └── 20 RESTful Endpoints                              │
└────────────────────────┬────────────────────────────────┘
                         │  psycopg Connection Pool · SSL
┌────────────────────────▼────────────────────────────────┐
│                    DATABASE LAYER                       │
│                                                         │
│   PostgreSQL on Neon (Serverless · AWS us-east-1)       │
│                                                         │
│   OLTP Tables                                           │
│   ├── suppliers       Vendor information                │
│   ├── products        SKU master data                   │
│   ├── sales           Transaction records               │
│   ├── purchases       Restocking records                │
│   └── stock_movements Full audit trail                  │
│                                                         │
│   OLAP Views                                            │
│   ├── monthly_sales_summary                             │
│   ├── product_profitability                             │
│   ├── inventory_turnover                                │
│   └── low_stock_report                                  │
│                                                         │
│   AI Views                                              │
│   ├── ai_insights        Risk scores · demand trends    │
│   ├── reorder_suggestions  IntelliReorder™ output       │
│   └── ai_budget_summary  Total restock budget           │
└─────────────────────────────────────────────────────────┘
```

---

## From OLTP to OLAP

Data in this system follows a deliberate progression from raw transactions to business intelligence:

```
OLTP (Write Layer)                   OLAP (Read Layer)
──────────────────                   ─────────────────
Every sale recorded       ──►  monthly_sales_summary
Every purchase logged      ──►  product_profitability
Every stock movement       ──►  inventory_turnover
tracked in real time       ──►  low_stock_report
                           ──►  ai_insights
                           ──►  reorder_suggestions
                           ──►  ai_budget_summary
```

OLTP tables (`sales`, `purchases`, `stock_movements`, `products`, `suppliers`) are optimised for fast, reliable writes — each transaction hits a single row with full integrity guarantees.

OLAP views sit on top of those tables and are optimised purely for reads. They pre-aggregate, join, and compute derived metrics (risk scores, turnover ratios, trend classifications) so the API never performs heavy calculation at request time — it simply queries a view.

This separation means:

| Benefit | Detail |
|:--------|:-------|
| Writes are never slowed | Analytical complexity stays in views, not transactions |
| Reads are never blocked | Transactional locking does not affect analytical queries |
| Easy extensibility | A new metric requires only a new view — no schema or backend changes |

---

## Data Flow Examples

<details>
<summary>Recording a Sale</summary>
<br>

```
1. Frontend  →  POST /sales  { product_id, quantity, sale_price, sale_date }
2. Backend   →  Validates stock availability
3. Database  →  INSERT into sales
               UPDATE products SET stock_quantity = stock_quantity - quantity
               INSERT into stock_movements (audit trail)
4. Cache     →  TTL invalidated on mutation
5. Frontend  →  Dashboard KPIs refresh automatically
```

</details>

<details>
<summary>Generating AI Insights</summary>
<br>

```
1. Frontend  →  GET /ai/insights
2. Backend   →  Checks 60s TTL cache (serves cached result if valid)
3. Database  →  Executes ai_insights view:
               · Computes avg daily sales (last 30 days vs prior 30 days)
               · Calculates bounded stockout risk score per product
               · Classifies demand trend: Rising / Stable / Declining
               · Groups products by risk classification
4. Backend   →  Stores result in cache
5. Frontend  →  Renders Stockout Risk tab + doughnut chart
```

</details>

---

## Caching Strategy

Read-heavy endpoints (dashboard, insights, profitability, reorder) use a 60-second TTL in-memory cache keyed by endpoint + query parameters. Any `POST`, `PUT`, or `DELETE` operation flushes the relevant cache keys to ensure consistency.

| Endpoint Group | Cached | Invalidated By |
|:---------------|:------:|:---------------|
| `/dashboard` | Yes (60s) | Any write operation |
| `/ai/*` | Yes (60s) | Any write operation |
| `/reorder` | Yes (60s) | Any write operation |
| `/products/profitability` | Yes (60s) | Any write operation |
| Write endpoints | No | — |

---

## Deployment Topology

```
GitHub
    │
    ├── Render (auto-deploy on push)
    │     └── FastAPI · Python 3.11 · Port $PORT
    │           └── Neon PostgreSQL (always-on connection pool)
    │
    └── Vercel (auto-deploy on push)
          └── React SPA · Vite build
                └── VITE_API_URL → Render backend
```

---

> [Intelligence Algorithms →](ALGORITHMS.md) · [API Reference →](API.md)
