-- ============================================================
-- Intelligent Inventory Database Schema
-- PostgreSQL / Neon Compatible
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

-- 1. Suppliers
-- ============================================================

CREATE TABLE suppliers (
    supplier_id    SERIAL PRIMARY KEY,
    name           VARCHAR(150) NOT NULL,
    contact_email  VARCHAR(150),
    phone          VARCHAR(50),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products
-- ============================================================

CREATE TABLE products (
    product_id     SERIAL PRIMARY KEY,
    name           VARCHAR(150) NOT NULL,
    category       VARCHAR(100),
    cost_price     NUMERIC(10,2) NOT NULL,
    selling_price  NUMERIC(10,2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    reorder_level  INTEGER NOT NULL DEFAULT 10,
    supplier_id    INTEGER REFERENCES suppliers(supplier_id),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_category ON products(category);

-- 3. Sales
-- ============================================================

CREATE TABLE sales (
    sale_id     SERIAL PRIMARY KEY,
    product_id  INTEGER REFERENCES products(product_id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    sale_price  NUMERIC(10,2) NOT NULL,
    sale_date   DATE NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sales_date           ON sales(sale_date);
CREATE INDEX idx_sales_product_id     ON sales(product_id);
CREATE INDEX idx_sales_product_date   ON sales(product_id, sale_date); -- speeds up per-product date-range queries

-- 4. Purchases
-- ============================================================

CREATE TABLE purchases (
    purchase_id     SERIAL PRIMARY KEY,
    product_id      INTEGER REFERENCES products(product_id),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    purchase_price  NUMERIC(10,2) NOT NULL,
    purchase_date   DATE NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_purchase_date ON purchases(purchase_date);

-- 5. Stock Movements
-- ============================================================

CREATE TABLE stock_movements (
    movement_id    SERIAL PRIMARY KEY,
    product_id     INTEGER REFERENCES products(product_id),
    movement_type  VARCHAR(20) CHECK (movement_type IN ('SALE','PURCHASE')),
    quantity       INTEGER NOT NULL,
    movement_date  DATE NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_movements_date ON stock_movements(movement_date);


-- ============================================================
-- OLAP VIEWS
-- ============================================================

-- 6. Monthly Sales Summary
-- ============================================================

CREATE VIEW monthly_sales_summary AS
SELECT
    DATE_TRUNC('month', sale_date)                              AS month,
    TO_CHAR(DATE_TRUNC('month', sale_date), 'Mon YYYY')         AS month_label,
    SUM(quantity)                                               AS total_units_sold,
    ROUND(SUM(quantity * sale_price)::numeric, 2)               AS total_revenue
FROM sales
GROUP BY DATE_TRUNC('month', sale_date)
ORDER BY month;

-- 7. Product Profitability
-- ============================================================

CREATE VIEW product_profitability AS
SELECT
    p.product_id,
    p.name                                                                          AS product_name,
    p.category,
    ROUND(SUM(s.quantity * s.sale_price)::numeric, 2)                               AS total_revenue,
    ROUND(SUM(s.quantity * (s.sale_price - p.cost_price))::numeric, 2)              AS gross_profit,
    ROUND(
        CASE WHEN SUM(s.quantity * s.sale_price) = 0 THEN 0
             ELSE SUM(s.quantity * (s.sale_price - p.cost_price))
                  / NULLIF(SUM(s.quantity * s.sale_price), 0) * 100
        END::numeric, 2
    )                                                                               AS profit_margin_pct
FROM products p
JOIN sales s ON p.product_id = s.product_id
GROUP BY p.product_id, p.name, p.category
ORDER BY gross_profit DESC;

-- 8. Inventory Turnover
-- ============================================================

CREATE VIEW inventory_turnover AS
SELECT
    p.product_id,
    p.name                                                              AS product_name,
    p.category,
    p.stock_quantity,
    COALESCE(SUM(s.quantity), 0)                                        AS total_units_sold,
    CASE
        WHEN p.stock_quantity = 0 THEN NULL
        ELSE ROUND((COALESCE(SUM(s.quantity), 0)::numeric / p.stock_quantity), 2)
    END                                                                 AS turnover_ratio,
    CASE
        WHEN p.stock_quantity = 0                                               THEN 'Out of Stock'
        WHEN COALESCE(SUM(s.quantity), 0)::float / p.stock_quantity > 10        THEN 'Fast'
        WHEN COALESCE(SUM(s.quantity), 0)::float / p.stock_quantity > 4         THEN 'Moderate'
        ELSE 'Slow'
    END                                                                 AS turnover_class
FROM products p
LEFT JOIN sales s ON p.product_id = s.product_id
GROUP BY p.product_id, p.name, p.category, p.stock_quantity
ORDER BY turnover_ratio DESC NULLS LAST;

-- 9. Low Stock Report
-- ============================================================

CREATE VIEW low_stock_report AS
SELECT
    p.product_id,
    p.name                              AS product_name,
    p.category,
    p.stock_quantity,
    p.reorder_level,
    p.reorder_level - p.stock_quantity  AS units_below_reorder,
    s.name                              AS supplier_name,
    s.contact_email                     AS supplier_email
FROM products p
JOIN suppliers s ON p.supplier_id = s.supplier_id
WHERE p.stock_quantity <= p.reorder_level
ORDER BY p.stock_quantity ASC;


-- ============================================================
-- AI VIEWS
-- ============================================================

-- 10. AI Insights — Risk Score + Demand Trend + Days Until Stockout
-- ============================================================

CREATE VIEW ai_insights AS
WITH ref AS (
    SELECT MAX(sale_date) AS latest FROM sales
),
sales_stats AS (
    SELECT
        s.product_id,
        COALESCE(
            SUM(s.quantity) FILTER (WHERE s.sale_date > r.latest - INTERVAL '30 days')::float
            / NULLIF(COUNT(DISTINCT s.sale_date) FILTER (WHERE s.sale_date > r.latest - INTERVAL '30 days'), 0),
            0
        ) AS avg_daily_current,
        COALESCE(
            SUM(s.quantity) FILTER (WHERE s.sale_date BETWEEN r.latest - INTERVAL '60 days' AND r.latest - INTERVAL '31 days')::float
            / NULLIF(COUNT(DISTINCT s.sale_date) FILTER (WHERE s.sale_date BETWEEN r.latest - INTERVAL '60 days' AND r.latest - INTERVAL '31 days'), 0),
            0
        ) AS avg_daily_previous
    FROM sales s, ref r
    GROUP BY s.product_id
)
SELECT
    p.product_id,
    p.name                                                                      AS product_name,
    p.category,
    p.stock_quantity,
    ROUND(COALESCE(ss.avg_daily_current, 0)::numeric, 2)                        AS avg_daily_sales,
    GREATEST(0, LEAST(100,
        ROUND(((1 - (p.stock_quantity::float
            / NULLIF(COALESCE(ss.avg_daily_current, 0) * 14, 0))) * 100)::numeric, 1)
    ))                                                                          AS risk_score,
    CASE
        WHEN GREATEST(0, LEAST(100, (1 - (p.stock_quantity::float / NULLIF(COALESCE(ss.avg_daily_current, 0) * 14, 0))) * 100)) >= 70 THEN 'Critical'
        WHEN GREATEST(0, LEAST(100, (1 - (p.stock_quantity::float / NULLIF(COALESCE(ss.avg_daily_current, 0) * 14, 0))) * 100)) >= 40 THEN 'High'
        WHEN GREATEST(0, LEAST(100, (1 - (p.stock_quantity::float / NULLIF(COALESCE(ss.avg_daily_current, 0) * 14, 0))) * 100)) >  0  THEN 'Medium'
        ELSE 'Safe'
    END                                                                         AS risk_level,
    CASE
        WHEN COALESCE(ss.avg_daily_current, 0) > COALESCE(ss.avg_daily_previous, 0) * 1.2 THEN 'Rising'
        WHEN COALESCE(ss.avg_daily_current, 0) < COALESCE(ss.avg_daily_previous, 0) * 0.8 THEN 'Declining'
        ELSE 'Stable'
    END                                                                         AS demand_trend,
    ROUND(
        p.stock_quantity::numeric / NULLIF(COALESCE(ss.avg_daily_current, 0)::numeric, 0), 1
    )                                                                           AS days_until_stockout
FROM products p
LEFT JOIN sales_stats ss ON p.product_id = ss.product_id
ORDER BY risk_score DESC;

-- 11. IntelliReorder™ — Reorder Suggestions
-- ============================================================

CREATE VIEW reorder_suggestions AS
WITH ref AS (
    SELECT MAX(sale_date) AS latest FROM sales
),
avg_sales AS (
    SELECT
        s.product_id,
        COALESCE(
            SUM(s.quantity)::float / NULLIF(COUNT(DISTINCT s.sale_date), 0),
            0
        ) AS avg_daily_sales
    FROM sales s, ref r
    WHERE s.sale_date > r.latest - INTERVAL '30 days'
    GROUP BY s.product_id
)
SELECT
    p.product_id,
    p.name                                                              AS product_name,
    p.category,
    p.stock_quantity,
    p.reorder_level,
    CEIL(COALESCE(a.avg_daily_sales, 0) * 8)::int                       AS recommended_qty,
    ROUND((CEIL(COALESCE(a.avg_daily_sales, 0) * 8) * p.cost_price)::numeric, 2) AS estimated_cost
FROM products p
LEFT JOIN avg_sales a ON p.product_id = a.product_id
WHERE p.stock_quantity <= p.reorder_level
ORDER BY p.stock_quantity ASC;

-- 12. AI Budget Summary
-- ============================================================

CREATE VIEW ai_budget_summary AS
SELECT
    COUNT(*)                                    AS products_to_reorder,
    ROUND(SUM(estimated_cost)::numeric, 2)      AS total_estimated_budget
FROM reorder_suggestions;
