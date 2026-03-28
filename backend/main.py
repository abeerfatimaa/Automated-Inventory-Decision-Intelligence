"""
Intelligent Inventory – FastAPI Backend
"""

import time
from typing import Optional
from datetime import date as DateType

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import get_conn
from .auth import auth_middleware, create_token, verify_credentials

app = FastAPI(
    title="Intelligent Inventory API",
    description="AI-Powered Inventory Intelligence",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(auth_middleware)


# ── TTL Cache (60 s) ──────────────────────────────────────────────────────────

_cache: dict = {}
_TTL = 60


def _cached(key: str, fn):
    entry = _cache.get(key)
    if entry and time.time() - entry[0] < _TTL:
        return entry[1]
    result = fn()
    _cache[key] = (time.time(), result)
    return result


def _bust_cache():
    """Clear all cached data after any mutation."""
    _cache.clear()


# ── Pydantic models ───────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    username: str
    password: str


class ProductIn(BaseModel):
    name: str
    category: str
    cost_price: float
    selling_price: float
    stock_quantity: int
    reorder_level: int
    supplier_id: int


class SaleIn(BaseModel):
    product_id: int
    quantity: int
    sale_price: float
    sale_date: DateType


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/auth/login")
def login(data: LoginIn):
    if not verify_credentials(data.username, data.password):
        raise HTTPException(401, "Invalid username or password")
    return {"token": create_token(data.username)}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "message": "Intelligent Inventory API is running"}


# ── Suppliers ─────────────────────────────────────────────────────────────────

@app.get("/suppliers")
def get_suppliers():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT supplier_id, name, contact_email, phone FROM suppliers ORDER BY name")
                return cur.fetchall()
    return _cached("suppliers", fetch)


# ── Dashboard KPIs ────────────────────────────────────────────────────────────

@app.get("/dashboard")
def get_dashboard(start_date: Optional[str] = None, end_date: Optional[str] = None):
    cache_key = f"dashboard_{start_date}_{end_date}"

    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                where  = "WHERE s.sale_date BETWEEN %s AND %s" if (start_date and end_date) else ""
                params = (start_date, end_date)                        if (start_date and end_date) else ()
                cur.execute(f"""
                    SELECT
                        COALESCE(SUM(s.quantity * s.sale_price), 0)                          AS total_revenue,
                        COALESCE(SUM(s.quantity * (s.sale_price - p.cost_price)), 0)         AS total_profit,
                        COUNT(s.sale_id)                                                      AS total_sales,
                        (SELECT COUNT(*) FROM products WHERE stock_quantity <= reorder_level) AS low_stock_count,
                        (SELECT COUNT(*) FROM products)                                       AS total_products
                    FROM sales s
                    JOIN products p ON s.product_id = p.product_id
                    {where}
                """, params)
                row = cur.fetchone()
        total_revenue = float(row["total_revenue"])
        total_profit  = float(row["total_profit"])
        return {
            "total_revenue_pkr":          round(total_revenue, 2),
            "total_gross_profit_pkr":     round(total_profit, 2),
            "profit_margin_pct":          round((total_profit / total_revenue * 100) if total_revenue else 0, 2),
            "total_products":             row["total_products"],
            "low_stock_alerts":           row["low_stock_count"],
            "total_sales_transactions":   row["total_sales"],
        }
    return _cached(cache_key, fetch)


# ── Monthly Sales ─────────────────────────────────────────────────────────────

@app.get("/sales/monthly")
def get_monthly_sales():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM monthly_sales_summary ORDER BY month")
                return cur.fetchall()
    return _cached("sales_monthly", fetch)


@app.get("/sales/monthly-profit")
def get_monthly_profit(start_date: Optional[str] = None, end_date: Optional[str] = None):
    cache_key = f"sales_monthly_profit_{start_date}_{end_date}"

    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                where  = "AND s.sale_date BETWEEN %s AND %s" if (start_date and end_date) else ""
                params = (start_date, end_date)                        if (start_date and end_date) else ()
                cur.execute(f"""
                    SELECT
                        DATE_TRUNC('month', s.sale_date)                              AS month,
                        TO_CHAR(DATE_TRUNC('month', s.sale_date), 'Mon YYYY')         AS month_label,
                        ROUND(SUM(s.quantity * s.sale_price), 2)                      AS total_revenue,
                        ROUND(SUM(s.quantity * (s.sale_price - p.cost_price)), 2)     AS gross_profit
                    FROM sales s
                    JOIN products p ON s.product_id = p.product_id
                    WHERE 1=1 {where}
                    GROUP BY DATE_TRUNC('month', s.sale_date)
                    ORDER BY month
                """, params)
                return cur.fetchall()
    return _cached(cache_key, fetch)


# ── Products ──────────────────────────────────────────────────────────────────

@app.get("/products")
def get_products():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT p.product_id, p.name, p.category,
                           p.cost_price, p.selling_price,
                           p.stock_quantity, p.reorder_level,
                           p.supplier_id,
                           s.name AS supplier_name
                    FROM products p
                    JOIN suppliers s ON p.supplier_id = s.supplier_id
                    ORDER BY p.category, p.name
                """)
                return cur.fetchall()
    return _cached("products", fetch)


@app.post("/products", status_code=201)
def create_product(data: ProductIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO products (name, category, cost_price, selling_price, stock_quantity, reorder_level, supplier_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING product_id
            """, (data.name, data.category, data.cost_price, data.selling_price,
                  data.stock_quantity, data.reorder_level, data.supplier_id))
            new_id = cur.fetchone()["product_id"]
    _bust_cache()
    return {"product_id": new_id, "status": "created"}


@app.put("/products/{product_id}")
def update_product(product_id: int, data: ProductIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE products
                SET name=%s, category=%s, cost_price=%s, selling_price=%s,
                    stock_quantity=%s, reorder_level=%s, supplier_id=%s
                WHERE product_id=%s
            """, (data.name, data.category, data.cost_price, data.selling_price,
                  data.stock_quantity, data.reorder_level, data.supplier_id, product_id))
            if cur.rowcount == 0:
                raise HTTPException(404, "Product not found")
    _bust_cache()
    return {"status": "updated"}


@app.delete("/products/{product_id}")
def delete_product(product_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM products WHERE product_id = %s", (product_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Product not found")
            # cascade-delete dependents so FK constraints don't block
            cur.execute("DELETE FROM stock_movements WHERE product_id = %s", (product_id,))
            cur.execute("DELETE FROM purchases      WHERE product_id = %s", (product_id,))
            cur.execute("DELETE FROM sales          WHERE product_id = %s", (product_id,))
            cur.execute("DELETE FROM products       WHERE product_id = %s", (product_id,))
    _bust_cache()
    return {"status": "deleted"}


# ── Profitability ─────────────────────────────────────────────────────────────

@app.get("/products/profitability")
def get_profitability(start_date: Optional[str] = None, end_date: Optional[str] = None):
    cache_key = f"product_profitability_{start_date}_{end_date}"

    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                if start_date and end_date:
                    # inline query so we can apply date filter
                    cur.execute("""
                        SELECT
                            p.product_id,
                            p.name  AS product_name,
                            p.category,
                            ROUND(SUM(s.quantity * s.sale_price)::numeric, 2)                      AS total_revenue,
                            ROUND(SUM(s.quantity * (s.sale_price - p.cost_price))::numeric, 2)     AS gross_profit,
                            ROUND(
                                CASE WHEN SUM(s.quantity * s.sale_price) = 0 THEN 0
                                     ELSE SUM(s.quantity * (s.sale_price - p.cost_price))
                                          / NULLIF(SUM(s.quantity * s.sale_price), 0) * 100
                                END::numeric, 2
                            ) AS profit_margin_pct
                        FROM products p
                        JOIN sales s ON p.product_id = s.product_id
                        WHERE s.sale_date BETWEEN %s AND %s
                        GROUP BY p.product_id, p.name, p.category
                        ORDER BY gross_profit DESC
                    """, (start_date, end_date))
                else:
                    cur.execute("SELECT * FROM product_profitability")
                return cur.fetchall()
    return _cached(cache_key, fetch)


@app.get("/products/{product_id}/history")
def get_product_history(product_id: int):
    """Monthly sales history for a single product (drill-down)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    TO_CHAR(DATE_TRUNC('month', sale_date), 'Mon YYYY') AS month_label,
                    SUM(quantity)::int                                   AS units_sold,
                    ROUND(SUM(quantity * sale_price)::numeric, 2)       AS revenue
                FROM sales
                WHERE product_id = %s
                GROUP BY DATE_TRUNC('month', sale_date)
                ORDER BY DATE_TRUNC('month', sale_date)
            """, (product_id,))
            return cur.fetchall()


@app.get("/products/{product_id}")
def get_product(product_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*, s.name AS supplier_name, s.contact_email, s.phone
                FROM products p
                JOIN suppliers s ON p.supplier_id = s.supplier_id
                WHERE p.product_id = %s
            """, (product_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Product not found")
    return row


# ── Sales ─────────────────────────────────────────────────────────────────────

@app.post("/sales", status_code=201)
def record_sale(data: SaleIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT stock_quantity, name FROM products WHERE product_id = %s", (data.product_id,))
            product = cur.fetchone()
            if not product:
                raise HTTPException(404, "Product not found")
            if product["stock_quantity"] < data.quantity:
                raise HTTPException(400, f"Insufficient stock — available: {product['stock_quantity']}")
            cur.execute(
                "INSERT INTO sales (product_id, quantity, sale_price, sale_date) VALUES (%s, %s, %s, %s)",
                (data.product_id, data.quantity, data.sale_price, data.sale_date),
            )
            cur.execute(
                "UPDATE products SET stock_quantity = stock_quantity - %s WHERE product_id = %s",
                (data.quantity, data.product_id),
            )
    _bust_cache()
    return {"status": "recorded"}


# ── Inventory Turnover ────────────────────────────────────────────────────────

@app.get("/inventory/turnover")
def get_turnover():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM inventory_turnover")
                return cur.fetchall()
    return _cached("inventory_turnover", fetch)


@app.get("/inventory/low-stock")
def get_low_stock():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM low_stock_report")
                return cur.fetchall()
    return _cached("inventory_low_stock", fetch)


# ── IntelliReorder™ ───────────────────────────────────────────────────────────

@app.get("/reorder")
def get_reorder_suggestions():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM reorder_suggestions")
                return cur.fetchall()
    return _cached("reorder", fetch)


# ── AI Intelligence ───────────────────────────────────────────────────────────

@app.get("/ai/insights")
def get_ai_insights():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM ai_insights")
                return cur.fetchall()
    return _cached("ai_insights", fetch)


@app.get("/ai/budget")
def get_ai_budget():
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM ai_budget_summary")
                return cur.fetchone()
    return _cached("ai_budget", fetch)


@app.get("/ai/anomalies")
def get_anomalies():
    """
    Detect products where sales in the last 7 days deviate >50% from
    the prior 30-day baseline. Uses the latest sale_date as reference
    so it works correctly with seeded/historical data.
    """
    def fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    WITH ref AS (
                        SELECT MAX(sale_date) AS latest FROM sales
                    ),
                    windows AS (
                        SELECT
                            s.product_id,
                            COALESCE(
                                SUM(s.quantity) FILTER (
                                    WHERE s.sale_date > r.latest - INTERVAL '7 days'
                                ), 0
                            )::float / 7  AS recent_avg,
                            COALESCE(
                                SUM(s.quantity) FILTER (
                                    WHERE s.sale_date BETWEEN r.latest - INTERVAL '37 days'
                                                          AND r.latest - INTERVAL '8 days'
                                ), 0
                            )::float / 30 AS baseline_avg
                        FROM sales s, ref r
                        GROUP BY s.product_id
                    )
                    SELECT
                        p.product_id,
                        p.name        AS product_name,
                        p.category,
                        ROUND(w.recent_avg::numeric,   2) AS recent_daily_avg,
                        ROUND(w.baseline_avg::numeric, 2) AS baseline_daily_avg,
                        CASE
                            WHEN w.baseline_avg = 0 AND w.recent_avg > 0             THEN 'Spike'
                            WHEN w.recent_avg   = 0 AND w.baseline_avg > 0           THEN 'Drop'
                            WHEN w.baseline_avg > 0 AND w.recent_avg / w.baseline_avg > 1.5 THEN 'Spike'
                            WHEN w.baseline_avg > 0 AND w.recent_avg / w.baseline_avg < 0.5 THEN 'Drop'
                        END AS anomaly_type,
                        CASE
                            WHEN w.baseline_avg > 0
                            THEN ROUND(((w.recent_avg - w.baseline_avg)
                                 / w.baseline_avg * 100)::numeric, 1)
                        END AS change_pct
                    FROM windows w
                    JOIN products p ON p.product_id = w.product_id
                    WHERE
                        (w.baseline_avg = 0 AND w.recent_avg > 0)
                        OR (w.recent_avg = 0 AND w.baseline_avg > 0)
                        OR (w.baseline_avg > 0
                            AND ABS(w.recent_avg / w.baseline_avg - 1) > 0.5)
                    ORDER BY
                        ABS(COALESCE(w.recent_avg / NULLIF(w.baseline_avg, 0) - 1, 1)) DESC
                    LIMIT 20
                """)
                return cur.fetchall()
    return _cached("ai_anomalies", fetch)
