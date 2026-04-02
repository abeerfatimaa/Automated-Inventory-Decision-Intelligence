# Intelligent Inventory Monitoring Agent

> Rule-based AI inventory intelligence for SMEs — built on FastAPI, React, and PostgreSQL.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=flat&logo=postgresql&logoColor=white)
![Deployed on Render](https://img.shields.io/badge/API-Render-46E3B7?style=flat&logo=render&logoColor=black)
![Deployed on Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?style=flat&logo=vercel&logoColor=white)

---

## Table of Contents

- [Live](#live)
- [STAR Overview](#star-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Documentation](#documentation)

---

## Live

| Service | Link |
|:--------|:-----|
| Dashboard | [intelligent-inventory.vercel.app](https://intelligent-inventory.vercel.app/) |
| API | [intelligent-inventory.onrender.com](https://intelligent-inventory.onrender.com/) |

---

## STAR Overview

<details>
<summary>Situation</summary>
<br>

Small and medium enterprises (SMEs) in retail, grocery, pharmacy, and distribution routinely face two costly extremes: stockouts that lose sales and erode customer trust, or overstock that ties up capital and increases waste. Most affordable tools offer only basic spreadsheet-style tracking — no forward-looking intelligence, no risk scoring, no demand trend awareness.

</details>

<details>
<summary>Task</summary>
<br>

Design and deploy a full-stack inventory intelligence platform that gives SME operators a real-time, data-driven view of their inventory health — without requiring a dedicated data analyst.

</details>

<details>
<summary>Action</summary>
<br>

Built a three-layer architecture combining OLTP, OLAP, and rule-based AI intelligence:

| Layer | Responsibility |
|:------|:---------------|
| Transactional (OLTP) | PostgreSQL on Neon serverless records every sale, purchase, and stock movement with a full audit trail |
| Analytical (OLAP) | Pre-computed SQL views aggregate monthly revenue, product profitability, and inventory turnover — eliminating runtime computation cost |
| Intelligence | Deterministic SQL algorithms score stockout risk (0–100), classify demand trends, detect anomalies, and generate reorder suggestions via the IntelliReorder™ formula |
| API | FastAPI serves 20 RESTful endpoints with a 60-second TTL cache on read-heavy routes |
| Dashboard | React 19 + Chart.js delivers a six-tab interactive dashboard with CSV/PDF export, dynamic filters, and drill-down visualizations |

</details>

<details>
<summary>Result</summary>
<br>

A production-ready MVP live across two free-tier cloud providers (Render + Vercel), backed by a Neon PostgreSQL database populated with 6 months of transactional data. The platform delivers instant inventory visibility — from high-level profit margins to product-level stockout countdowns — with zero dependency on paid analytics tools.

</details>

---

## Features

| Module | Capability |
|:-------|:-----------|
| Overview Dashboard | Revenue, gross profit, profit margin %, active alerts, monthly bar chart |
| Profitability Analysis | Products ranked by gross profit and margin %; filterable by date and category |
| Inventory Turnover | Fast / Moderate / Slow classification using sales-to-stock ratio |
| Stockout Risk | Bounded 0–100 risk score per product; days-until-stockout countdown |
| IntelliReorder™ | Automated reorder quantity suggestions with estimated restock budget |
| Anomaly Alerts | Demand spike/drop detection vs. 30-day rolling baseline |

---

## Tech Stack

| Layer | Technologies |
|:------|:-------------|
| Backend | Python 3.11+ · FastAPI 0.115 · Uvicorn 0.30 · psycopg 3.2 · Pandas 2.2 |
| Frontend | React 19 · Vite 7 · Chart.js 4.5 · Axios 1.13 · jsPDF 4.2 |
| Infrastructure | Render (API) · Vercel (SPA) · Neon (serverless PostgreSQL, AWS us-east-1) |

---

## Documentation

| Document | Description |
|:---------|:------------|
| [Architecture & Data Flow](ARCHITECTURE.md) | System layers, data flow, caching, and deployment topology |
| [Intelligence Algorithms](ALGORITHMS.md) | SQL formulas behind every score and classification |
| [API Reference](API.md) | All 20 endpoints with request/response details |

---

Built by [Abeer Fatima](mailto:abeer.fatima.bzu@gmail.com)
