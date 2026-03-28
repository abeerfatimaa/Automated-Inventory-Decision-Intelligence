"""
Intelligent Inventory – Database connection (connection pool)
"""

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


def _configure(conn):
    conn.row_factory = dict_row


pool = ConnectionPool(
    DATABASE_URL,
    min_size=2,
    max_size=10,
    configure=_configure,
)


def get_conn():
    """Return a pooled connection context manager."""
    return pool.connection()
