# Intelligence Algorithms

> [← Back to README](README.md)

---

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [Stockout Risk Score](#stockout-risk-score)
- [Demand Trend Classification](#demand-trend-classification)
- [IntelliReorder™ — Reorder Quantity](#intellireorder--reorder-quantity)
- [Inventory Turnover Classification](#inventory-turnover-classification)
- [Anomaly Detection](#anomaly-detection)
- [Days Until Stockout](#days-until-stockout)

---

## Design Philosophy

All intelligence in this platform is deterministic SQL — no machine learning models, no external AI APIs, no black boxes. Every score and classification is a formula a business analyst could verify on paper.

| Principle | Rationale |
|:----------|:----------|
| Transparent | Every result is fully explainable to a non-technical business owner |
| Fast | Logic runs inside the database as pre-computed views — no Python processing overhead |
| Reliable | No model drift, no retraining, no probabilistic uncertainty |
| Free | Zero dependency on paid AI services |

---

## Stockout Risk Score

Produces a bounded 0–100 risk score per product reflecting how close it is to running out of stock relative to the time needed to restock.

```sql
risk_score = GREATEST(0, LEAST(100,
    (1 - (stock_quantity / (avg_daily_sales * 14))) * 100
))
```

| Component | Value | Rationale |
|:----------|:-----:|:----------|
| Supplier lead time | 5 days | Average time from order to delivery |
| Safety buffer | 3 days | Absorbs demand spikes or delivery delays |
| Margin | 6 days | Additional runway before action is critical |
| Total window | 14 days | — |

<details>
<summary>Risk Classification</summary>
<br>

| Score | Level | Meaning |
|:-----:|:------|:--------|
| 70 – 100 | Critical | Immediate reorder required |
| 40 – 69 | High | Monitor closely |
| 1 – 39 | Medium | Low urgency |
| 0 | Safe | Well-stocked |

</details>

---

## Demand Trend Classification

Compares average daily sales over the last 30 days against the prior 30-day period to detect directional demand shifts.

```
current_avg  = SUM(qty) / COUNT(DISTINCT sale_date)  [last 30 days]
previous_avg = SUM(qty) / COUNT(DISTINCT sale_date)  [days 31–60]

Rising    → current_avg > previous_avg × 1.2   (+20% threshold)
Declining → current_avg < previous_avg × 0.8   (−20% threshold)
Stable    → otherwise
```

A ±20% threshold filters out normal day-to-day variance, surfacing only meaningful trend changes.

---

## IntelliReorder™ — Reorder Quantity

Calculates how much to order when a product hits its reorder level, covering the full restocking window plus a safety buffer.

```
recommended_qty = CEIL(avg_daily_sales × 8)
```

| Component | Days |
|:----------|:----:|
| Supplier lead time | 5 |
| Safety stock buffer | 3 |
| Total | 8 |

Trigger condition: `stock_quantity ≤ reorder_level`

The result is rounded up (CEIL) to avoid fractional order quantities.

---

## Inventory Turnover Classification

Measures how efficiently stock is being sold relative to current inventory levels.

```
turnover_ratio = total_units_sold / current_stock_quantity

Fast     → ratio > 10
Moderate → 4 < ratio ≤ 10
Slow     → ratio ≤ 4
```

High turnover indicates strong demand and lean inventory. Low turnover flags potential deadstock or overstocking.

---

## Anomaly Detection

Identifies products with unusual demand behaviour by comparing recent sales velocity to a 30-day baseline.

```
baseline_avg = AVG(daily_qty)   [last 30 days]
recent_avg   = AVG(daily_qty)   [last 7 days]

deviation = ABS(recent_avg - baseline_avg) / NULLIF(baseline_avg, 0)

Anomaly flagged when: deviation > 0.5  (>50% change)

Spike → recent_avg > baseline_avg
Drop  → recent_avg < baseline_avg
```

The top 20 anomalies by deviation magnitude are surfaced on the Anomaly Alerts tab.

---

## Days Until Stockout

A companion metric to the risk score — gives operators a concrete countdown in days.

```
days_until_stockout = stock_quantity / NULLIF(avg_daily_sales, 0)
```

Products with zero average daily sales return NULL (no meaningful stockout risk from sales velocity).

---

> [Architecture & Data Flow →](ARCHITECTURE.md) · [API Reference →](API.md)
