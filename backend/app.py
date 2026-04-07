from __future__ import annotations

import sqlite3
from datetime import date, datetime, time, timedelta
from pathlib import Path

from flask import Flask, jsonify, request

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "workflow_tracker.db"

app = Flask(__name__)


def now_iso() -> str:
    return datetime.now().replace(second=0, microsecond=0).isoformat(timespec="minutes")


def parse_datetime(value: str | None):
    return datetime.fromisoformat(value) if value else None


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def serialize_item(row: sqlite3.Row) -> dict:
    scheduled = parse_datetime(row["scheduled_for"])
    ends_at = scheduled + timedelta(minutes=row["duration"]) if scheduled else None
    overdue = row["status"] != "done" and ends_at is not None and ends_at < datetime.now()
    return {
      "id": row["id"],
      "title": row["title"],
      "description": row["description"],
      "item_type": row["item_type"],
      "priority": row["priority"],
      "category": row["category"],
      "status": row["status"],
      "scheduled_for": row["scheduled_for"],
      "duration": row["duration"],
      "repeat_rule": row["repeat_rule"],
      "notes": row["notes"],
      "completed_at": row["completed_at"],
      "created_at": row["created_at"],
      "updated_at": row["updated_at"],
      "ends_at": ends_at.isoformat(timespec="minutes") if ends_at else None,
      "is_overdue": overdue,
    }


def init_db() -> None:
    connection = get_db()
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            item_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL,
            scheduled_for TEXT,
            duration INTEGER NOT NULL,
            repeat_rule TEXT NOT NULL,
            notes TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER,
            action TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    count = connection.execute("SELECT COUNT(*) AS count FROM items").fetchone()["count"]
    if count == 0:
        today = date.today()
        seed = [
            ("Morning gym", "Strength and mobility session", "habit", "high", "Health", "done", datetime.combine(today, time(hour=6, minute=30)).isoformat(timespec="minutes"), 60, "daily", "Track energy", now_iso()),
            ("Deep work block", "Build Neuro Tracker features", "task", "critical", "Work", "in progress", datetime.combine(today, time(hour=9, minute=0)).isoformat(timespec="minutes"), 120, "none", "Finish main workspace", None),
            ("Team sync", "Weekly review and planning", "meeting", "medium", "Meetings", "todo", datetime.combine(today, time(hour=15, minute=0)).isoformat(timespec="minutes"), 45, "weekly", "Review blockers", None),
        ]
        for title, description, item_type, priority, category, status, scheduled_for, duration, repeat_rule, notes, completed_at in seed:
            stamp = now_iso()
            connection.execute(
                """
                INSERT INTO items (
                    title, description, item_type, priority, category, status,
                    scheduled_for, duration, repeat_rule, notes, completed_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (title, description, item_type, priority, category, status, scheduled_for, duration, repeat_rule, notes, completed_at, stamp, stamp),
            )
        connection.execute("INSERT INTO activity_log (task_id, action, label, created_at) VALUES (NULL, 'seeded', 'Loaded starter items', ?)", (now_iso(),))
    connection.commit()
    connection.close()


def report_payload(period: str) -> dict:
    connection = get_db()
    rows = connection.execute("SELECT * FROM items ORDER BY COALESCE(scheduled_for, created_at)").fetchall()
    items = [serialize_item(row) for row in rows]
    completed = [item for item in items if item["status"] == "done"]
    pending = [item for item in items if item["status"] != "done"]
    overdue = [item for item in items if item["is_overdue"]]
    meetings = [item for item in items if item["item_type"] == "meeting"]
    categories: dict[str, int] = {}
    for item in items:
        categories[item["category"]] = categories.get(item["category"], 0) + 1
    connection.close()
    return {
        "period": period,
        "metrics": {
            "total": len(items),
            "completed": len(completed),
            "pending": len(pending),
            "overdue": len(overdue),
            "meetings": len(meetings),
            "habits_completed": len([item for item in completed if item["item_type"] == "habit"]),
            "completion_rate": round((len(completed) / len(items)) * 100) if items else 0,
        },
        "summary": f"{len(completed)} completed, {len(pending)} active, {len(overdue)} overdue.",
        "highlights": [{"category": key, "count": value} for key, value in sorted(categories.items(), key=lambda item: item[1], reverse=True)[:4]],
    }


@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options(_path: str):
    return ("", 204)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/")
def index():
    return jsonify({"status": "ok", "message": "Neuro Tracker backend is running"})


@app.route("/api/tasks")
def get_tasks():
    connection = get_db()
    rows = connection.execute("SELECT * FROM items ORDER BY COALESCE(scheduled_for, created_at)").fetchall()
    connection.close()
    return jsonify({"items": [serialize_item(row) for row in rows]})


@app.route("/api/tasks", methods=["POST"])
def create_task():
    payload = request.get_json(silent=True) or {}
    stamp = now_iso()
    connection = get_db()
    cursor = connection.execute(
        """
        INSERT INTO items (
            title, description, item_type, priority, category, status,
            scheduled_for, duration, repeat_rule, notes, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.get("title", "Untitled"),
            payload.get("description", ""),
            payload.get("item_type", "task"),
            payload.get("priority", "medium"),
            payload.get("category", "General"),
            payload.get("status", "todo"),
            payload.get("scheduled_for"),
            int(payload.get("duration", 30)),
            payload.get("repeat_rule", "none"),
            payload.get("notes", ""),
            stamp if payload.get("status") == "done" else None,
            stamp,
            stamp,
        ),
    )
    connection.execute("INSERT INTO activity_log (task_id, action, label, created_at) VALUES (?, 'created', ?, ?)", (cursor.lastrowid, f"Created {payload.get('title', 'item')}", stamp))
    connection.commit()
    row = connection.execute("SELECT * FROM items WHERE id = ?", (cursor.lastrowid,)).fetchone()
    connection.close()
    return jsonify({"item": serialize_item(row)}), 201


@app.route("/api/tasks/<int:item_id>", methods=["PUT"])
def update_task(item_id: int):
    payload = request.get_json(silent=True) or {}
    stamp = now_iso()
    connection = get_db()
    existing = connection.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        connection.close()
        return jsonify({"error": "Item not found"}), 404
    connection.execute(
        """
        UPDATE items
        SET title = ?, description = ?, item_type = ?, priority = ?, category = ?, status = ?,
            scheduled_for = ?, duration = ?, repeat_rule = ?, notes = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            payload.get("title", existing["title"]),
            payload.get("description", existing["description"]),
            payload.get("item_type", existing["item_type"]),
            payload.get("priority", existing["priority"]),
            payload.get("category", existing["category"]),
            payload.get("status", existing["status"]),
            payload.get("scheduled_for", existing["scheduled_for"]),
            int(payload.get("duration", existing["duration"])),
            payload.get("repeat_rule", existing["repeat_rule"]),
            payload.get("notes", existing["notes"]),
            stamp if payload.get("status", existing["status"]) == "done" else None,
            stamp,
            item_id,
        ),
    )
    connection.execute("INSERT INTO activity_log (task_id, action, label, created_at) VALUES (?, 'updated', ?, ?)", (item_id, f"Updated {payload.get('title', existing['title'])}", stamp))
    connection.commit()
    row = connection.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    connection.close()
    return jsonify({"item": serialize_item(row)})


@app.route("/api/tasks/<int:item_id>", methods=["DELETE"])
def delete_task(item_id: int):
    connection = get_db()
    existing = connection.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
      connection.close()
      return jsonify({"error": "Item not found"}), 404
    connection.execute("DELETE FROM items WHERE id = ?", (item_id,))
    connection.execute("INSERT INTO activity_log (task_id, action, label, created_at) VALUES (?, 'deleted', ?, ?)", (item_id, f"Deleted {existing['title']}", now_iso()))
    connection.commit()
    connection.close()
    return jsonify({"success": True})


@app.route("/api/dashboard")
def dashboard():
    connection = get_db()
    rows = connection.execute("SELECT * FROM items ORDER BY COALESCE(scheduled_for, created_at)").fetchall()
    items = [serialize_item(row) for row in rows]
    today = date.today().isoformat()
    schedule = [item for item in items if item["scheduled_for"] and item["scheduled_for"].startswith(today)]
    recent = connection.execute("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 6").fetchall()
    connection.close()
    return jsonify({
        "totals": {
            "total": len(items),
            "completed": len([item for item in items if item["status"] == "done"]),
            "pending": len([item for item in items if item["status"] != "done"]),
            "overdue": len([item for item in items if item["is_overdue"]]),
        },
        "todays_schedule": schedule,
        "recent_activity": [dict(row) for row in recent],
    })


@app.route("/api/analytics")
def analytics():
    connection = get_db()
    rows = connection.execute("SELECT * FROM items ORDER BY COALESCE(scheduled_for, created_at)").fetchall()
    items = [serialize_item(row) for row in rows]
    connection.close()
    categories: dict[str, int] = {}
    types: dict[str, int] = {}
    for item in items:
        categories[item["category"]] = categories.get(item["category"], 0) + 1
        types[item["item_type"]] = types.get(item["item_type"], 0) + 1
    return jsonify({
        "tasks_by_category": [{"category": key, "count": value} for key, value in sorted(categories.items(), key=lambda item: item[1], reverse=True)],
        "tasks_by_type": [{"type": key, "count": value} for key, value in types.items()],
        "completion_rate": round((len([item for item in items if item["status"] == "done"]) / len(items)) * 100) if items else 0,
        "weekly_trend": [{"label": label, "completed": value, "created": value + 1} for label, value in zip(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [1, 2, 1, 3, 2, 4, 3])],
        "productivity_score": min(100, 55 + len([item for item in items if item["status"] == "done"]) * 8),
    })


@app.route("/api/reports/<period>")
def reports(period: str):
    if period not in {"daily", "weekly", "monthly"}:
        return jsonify({"error": "Invalid report period"}), 400
    return jsonify(report_payload(period))


init_db()

if __name__ == "__main__":
    app.run(debug=True)
