# API Reference

> [← Back to README](README.md)

**Base URL:** `https://intelligent-inventory.onrender.com`
**Interactive Docs (Swagger UI):** [/docs](https://intelligent-inventory.onrender.com/docs)

---

## Table of Contents

- [Dashboard](#dashboard)
- [Products](#products)
- [Profitability](#profitability)
- [Inventory](#inventory)
- [Suppliers](#suppliers)
- [AI & Intelligence](#ai--intelligence)
- [Reorder](#reorder)
- [Notes](#notes)

---

## Dashboard

### `GET /dashboard`
Returns aggregated KPIs for the overview panel.

Response includes: total revenue (PKR), gross profit (PKR), profit margin %, total products, low stock alert count, total transactions.

### `GET /sales/monthly`
Monthly revenue summaries across all recorded periods.

### `GET /sales/monthly-profit`
Monthly profit trends. Supports optional `start_date` and `end_date` query parameters (`YYYY-MM-DD`).

---

## Products

| Method | Endpoint | Description |
|:------:|:---------|:------------|
| `GET` | `/products` | All products with supplier details |
| `GET` | `/products/{id}` | Single product with full supplier information |
| `POST` | `/products` | Create a new product |
| `PUT` | `/products/{id}` | Update an existing product |
| `DELETE` | `/products/{id}` | Delete a product and cascade dependents |
| `GET` | `/products/{id}/history` | Monthly sales history for a specific product (drill-down) |

---

## Profitability

### `GET /products/profitability`
Products ranked by gross profit with margin percentages.

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `start_date` | `YYYY-MM-DD` | Filter from date |
| `end_date` | `YYYY-MM-DD` | Filter to date |
| `category` | string | Filter by product category |

---

## Inventory

### `GET /inventory/turnover`
Products classified as Fast / Moderate / Slow moving based on turnover ratio.

Query Parameters: `category` (optional)

### `GET /inventory/low-stock`
Products currently at or below their reorder level.

### `POST /sales`
Record a sale transaction. Automatically reduces stock quantity.

<details>
<summary>Request Body</summary>
<br>

```json
{
  "product_id": 1,
  "quantity": 10,
  "sale_price": 250.00,
  "sale_date": "2025-10-15"
}
```

</details>

---

## Suppliers

### `GET /suppliers`
All suppliers with contact details.

---

## AI & Intelligence

### `GET /ai/insights`
Risk scores and demand trend classification per product.

Response includes per product: stockout risk score (0–100), risk level (Critical / High / Medium / Safe), demand trend (Rising / Stable / Declining), days until stockout.

> Cached for 60 seconds.

### `GET /ai/anomalies`
Top 20 products with demand deviations exceeding 50% vs. the 30-day baseline.

Response includes: deviation %, anomaly type (Spike / Drop), recent vs. baseline averages.

### `GET /ai/budget`
Estimated total restock budget across all products flagged for reorder.

---

## Reorder

### `GET /reorder`
IntelliReorder™ suggestions — products at or below reorder level with recommended order quantities.

Response includes: product name, current stock, reorder level, recommended quantity, estimated cost.

> Cached for 60 seconds.

---

## Notes

| Topic | Detail |
|:------|:-------|
| Cache | Read-heavy endpoints (`/dashboard`, `/ai/*`, `/reorder`, `/products/profitability`) use a 60-second TTL cache. Any write operation (`POST`, `PUT`, `DELETE`) invalidates relevant cache keys |
| Errors | Standard HTTP status codes — `404` for not found, `400` for validation errors |
| Date formats | All dates use `YYYY-MM-DD` |
| Currency | All monetary values are in PKR (Pakistani Rupee) |

---

> [Architecture & Data Flow →](ARCHITECTURE.md) · [Intelligence Algorithms →](ALGORITHMS.md)
