"use client";

import Link from "next/link";
import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import "./neuro-tracker.css";

type PageView = "dashboard" | "tasks" | "schedule" | "analytics" | "reports";
type ItemType = "task" | "habit" | "meeting";
type Priority = "low" | "medium" | "high" | "critical";
type Status = "todo" | "in progress" | "done";
type RepeatRule = "none" | "daily" | "weekly";

type TaskItem = {
  id: number;
  title: string;
  description: string;
  item_type: ItemType;
  priority: Priority;
  category: string;
  status: Status;
  scheduled_for: string | null;
  duration: number;
  repeat_rule: RepeatRule;
  notes: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  ends_at: string | null;
  is_overdue: boolean;
};

type DashboardData = {
  totals: { total: number; completed: number; pending: number; overdue: number };
  todays_schedule: TaskItem[];
  recent_activity: { id: number; task_id: number | null; action: string; label: string; created_at: string }[];
};

type AnalyticsData = {
  tasks_by_category: { category: string; count: number }[];
  tasks_by_type: { type: ItemType; count: number }[];
  completion_rate: number;
  weekly_trend: { label: string; completed: number; created: number }[];
  productivity_score: number;
};

type ReportData = {
  period: "daily" | "weekly" | "monthly";
  metrics: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    meetings: number;
    habits_completed: number;
    completion_rate: number;
  };
  summary: string;
  highlights: { category: string; count: number }[];
};

type FormState = {
  title: string;
  description: string;
  item_type: ItemType;
  priority: Priority;
  category: string;
  status: Status;
  scheduled_date: string;
  scheduled_time: string;
  duration: string;
  repeat_rule: RepeatRule;
  notes: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:5000/api";

const emptyForm: FormState = {
  title: "",
  description: "",
  item_type: "task",
  priority: "medium",
  category: "General",
  status: "todo",
  scheduled_date: "",
  scheduled_time: "",
  duration: "45",
  repeat_rule: "none",
  notes: ""
};

const navItems: { href: string; label: string; page: PageView }[] = [
  { href: "/", label: "Dashboard", page: "dashboard" },
  { href: "/tasks", label: "Tasks", page: "tasks" },
  { href: "/schedule", label: "Schedule", page: "schedule" },
  { href: "/analytics", label: "Analytics", page: "analytics" },
  { href: "/reports", label: "Reports", page: "reports" }
];

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateTime(value: string | null) {
  return value ? new Date(value) : null;
}

function combineDateTime(date: string, time: string) {
  return date ? `${date}T${time || "09:00"}` : null;
}

function titleCase(value: string) {
  return value === "in progress" ? "In Progress" : value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateTime(value: string | null, fallback = "Unscheduled") {
  const date = parseDateTime(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date)
    : fallback;
}

function formatTime(value: string | null) {
  const date = parseDateTime(value);
  return date ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date) : "Flexible";
}

function sortBySchedule(items: TaskItem[]) {
  return [...items].sort((left, right) => {
    if (!left.scheduled_for && !right.scheduled_for) return 0;
    if (!left.scheduled_for) return 1;
    if (!right.scheduled_for) return -1;
    return new Date(left.scheduled_for).getTime() - new Date(right.scheduled_for).getTime();
  });
}

function buildCalendarDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const cursor = new Date(start);
  cursor.setDate(start.getDate() - start.getDay());
  const finish = new Date(end);
  finish.setDate(end.getDate() + (6 - end.getDay()));
  const days: Date[] = [];
  while (cursor <= finish) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw payload;
  return payload as T;
}

export default function NeuroTrackerApp({ page }: { page: PageView }) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [reports, setReports] = useState<Record<"daily" | "weekly" | "monthly", ReportData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toast, setToast] = useState("");
  const [apiError, setApiError] = useState("");
  const [selectedDate, setSelectedDate] = useState(toDateInput(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [filters, setFilters] = useState({ search: "", status: "all", type: "all" });
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropStatus, setDropStatus] = useState<Status | null>(null);
  const deferredSearch = useDeferredValue(filters.search);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? "" : current)), 2800);
  }

  async function loadData(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [taskData, dashboardData, analyticsData, daily, weekly, monthly] = await Promise.all([
        api<{ items: TaskItem[] }>("/tasks"),
        api<DashboardData>("/dashboard"),
        api<AnalyticsData>("/analytics"),
        api<ReportData>("/reports/daily"),
        api<ReportData>("/reports/weekly"),
        api<ReportData>("/reports/monthly")
      ]);
      setItems(sortBySchedule(taskData.items));
      setDashboard(dashboardData);
      setAnalytics(analyticsData);
      setReports({ daily, weekly, monthly });
      setApiError("");
    } catch (error) {
      setApiError(typeof error === "object" && error && "error" in error ? String(error.error) : "Backend unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredItems = items.filter((item) => {
    const text = deferredSearch.trim().toLowerCase();
    if (text && !`${item.title} ${item.description} ${item.category} ${item.notes}`.toLowerCase().includes(text)) return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.type !== "all" && item.item_type !== filters.type) return false;
    return true;
  });

  const selectedDayItems = sortBySchedule(items.filter((item) => item.scheduled_for && toDateInput(new Date(item.scheduled_for)) === selectedDate));
  const days = buildCalendarDays(calendarMonth);
  const todaySchedule = dashboard?.todays_schedule ?? [];
  const recentActivity = dashboard?.recent_activity ?? [];
  const heroFocus = todaySchedule[0];
  const secondaryFocus = todaySchedule[1];
  const completion = analytics?.completion_rate ?? 0;

  function openCreateModal() {
    setEditingItem(null);
    setForm({ ...emptyForm, scheduled_date: selectedDate, scheduled_time: "09:00" });
    setModalOpen(true);
  }

  function openEditModal(item: TaskItem) {
    const scheduled = parseDateTime(item.scheduled_for);
    setEditingItem(item);
    setForm({
      title: item.title,
      description: item.description,
      item_type: item.item_type,
      priority: item.priority,
      category: item.category,
      status: item.status,
      scheduled_date: scheduled ? toDateInput(scheduled) : "",
      scheduled_time: scheduled ? item.scheduled_for?.slice(11, 16) ?? "" : "",
      duration: String(item.duration),
      repeat_rule: item.repeat_rule,
      notes: item.notes
    });
    setModalOpen(true);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      title: form.title,
      description: form.description,
      item_type: form.item_type,
      priority: form.priority,
      category: form.category,
      status: form.status,
      scheduled_for: combineDateTime(form.scheduled_date, form.scheduled_time),
      duration: Number(form.duration),
      repeat_rule: form.repeat_rule,
      notes: form.notes
    };
    try {
      await api(editingItem ? `/tasks/${editingItem.id}` : "/tasks", {
        method: editingItem ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setModalOpen(false);
      notify(editingItem ? "Item updated" : "Item created");
      await loadData(true);
    } catch (error) {
      notify(typeof error === "object" && error && "error" in error ? String(error.error) : "Unable to save");
    }
  }

  async function updateStatus(item: TaskItem, status: Status) {
    try {
      await api(`/tasks/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: item.title,
          description: item.description,
          item_type: item.item_type,
          priority: item.priority,
          category: item.category,
          status,
          scheduled_for: item.scheduled_for,
          duration: item.duration,
          repeat_rule: item.repeat_rule,
          notes: item.notes
        })
      });
      await loadData(true);
    } catch {
      notify("Unable to move item");
    }
  }

  async function deleteItem(item: TaskItem) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await api(`/tasks/${item.id}`, { method: "DELETE" });
    setModalOpen(false);
    notify("Item deleted");
    await loadData(true);
  }

  async function handleDrop(status: Status) {
    if (draggedId === null) return;
    const item = items.find((entry) => entry.id === draggedId);
    setDraggedId(null);
    setDropStatus(null);
    if (!item || item.status === status) return;
    await updateStatus(item, status);
    notify(`${item.title} moved to ${titleCase(status)}`);
  }

  return (
    <main className="nt-shell">
      <section className="nt-main">
        <header className="nt-topbar">
          <div className="nt-brand">
            <span className="nt-brand-mark">N</span>
            <div>
              <strong>Neuro Tracker</strong>
              <span>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short" }).format(new Date())}</span>
            </div>
          </div>
          <nav className="nt-nav">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={`nt-nav-link ${page === item.page ? "is-active" : ""}`}>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="nt-actions nt-actions-topbar">
            <button className="nt-button nt-button-solid" type="button" onClick={openCreateModal}>
              New item
            </button>
            <button className="nt-icon-button" type="button" onClick={() => void loadData(true)} aria-label="Refresh">
              {refreshing ? "..." : "+"}
            </button>
          </div>
        </header>

        <header className="nt-header">
          <div>
            <span className="nt-label">Workspace</span>
            <h1>{page === "dashboard" ? "Dashboard" : titleCase(page)}</h1>
          </div>
        </header>

        {apiError ? (
          <div className="nt-alert">
            <strong>Backend unavailable</strong>
            <span>{apiError}</span>
          </div>
        ) : null}

        {page === "dashboard" ? (
          <>
            <section className="nt-dashboard-grid">
              <article className="nt-panel nt-welcome-card">
                <span className="nt-label">Today</span>
                <h2>Hello</h2>
                <p>Stay steady and keep the day simple.</p>
                <div className="nt-mini-calendar">
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                    <div key={`${day}-${index}`} className={`nt-mini-day ${index === new Date().getDay() ? "is-current" : ""}`}>{day}</div>
                  ))}
                </div>
              </article>
              <article className="nt-panel nt-highlight-card">
                <div className="nt-panel-head"><span className="nt-label">Focus block</span><h2>{heroFocus ? formatTime(heroFocus.scheduled_for) : "--:--"}</h2></div>
                <strong>{heroFocus?.title ?? "No focus block yet"}</strong>
                <p>{heroFocus?.description ?? "Create a task or habit to anchor the day."}</p>
                <div className="nt-highlight-curve" />
              </article>
              <article className="nt-panel nt-stat-card">
                <span className="nt-label">Completed</span>
                <strong>{dashboard?.totals.completed ?? 0}</strong>
                <p>Finished items</p>
              </article>
              <article className="nt-panel nt-stat-card nt-stat-card-warm">
                <span className="nt-label">Pending</span>
                <strong>{dashboard?.totals.pending ?? 0}</strong>
                <p>Planned items</p>
              </article>
            </section>

            <section className="nt-grid nt-grid-dashboard nt-grid-dashboard-reference">
              <article className="nt-panel nt-schedule-card">
                <div className="nt-panel-head"><span className="nt-label">Today</span><h2>Schedule</h2></div>
                <div className="nt-list">
                  {todaySchedule.map((item) => (
                    <button key={item.id} className="nt-row-card" type="button" onClick={() => openEditModal(item)}>
                      <div><strong>{item.title}</strong><span>{formatTime(item.scheduled_for)} • {item.duration} min</span></div>
                      <span className={`nt-tag nt-tag-${item.item_type}`}>{titleCase(item.item_type)}</span>
                    </button>
                  ))}
                </div>
              </article>

              <article className="nt-panel nt-compact-metrics-card">
                <div className="nt-panel-head"><span className="nt-label">Completion</span><h2>{completion}%</h2></div>
                <div className="nt-rail nt-rail-large"><div className="nt-rail-fill" style={{ width: `${completion}%` }} /></div>
                <div className="nt-metric-pills">
                  <span className="nt-chip">Total {dashboard?.totals.total ?? 0}</span>
                  <span className="nt-chip">Overdue {dashboard?.totals.overdue ?? 0}</span>
                  <span className="nt-chip">Meetings {items.filter((item) => item.item_type === "meeting").length}</span>
                </div>
                <div className="nt-secondary-card">
                  <span className="nt-label">Next</span>
                  <strong>{secondaryFocus?.title ?? "No next item"}</strong>
                  <p>{secondaryFocus ? formatDateTime(secondaryFocus.scheduled_for) : "Plan your next slot."}</p>
                </div>
              </article>

              <article className="nt-panel nt-activity-card">
                <div className="nt-panel-head"><span className="nt-label">Activity</span><h2>Recent</h2></div>
                <div className="nt-list">
                  {recentActivity.map((entry) => (
                    <div key={entry.id} className="nt-activity-item">
                      <div className="nt-dot" />
                      <div><strong>{entry.label}</strong><span>{formatDateTime(entry.created_at)}</span></div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="nt-panel nt-analytics-preview-card">
                <div className="nt-panel-head"><span className="nt-label">Analytics</span><h2>{analytics?.productivity_score ?? 0}</h2></div>
                <div className="nt-preview-bars">
                  {(analytics?.weekly_trend ?? []).slice(-5).map((entry) => (
                    <div key={entry.label} className="nt-preview-bar-group">
                      <div className="nt-preview-bar-track">
                        <div className="nt-preview-bar-fill" style={{ height: `${Math.max(18, entry.completed * 20)}%` }} />
                      </div>
                      <span>{entry.label}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {page === "tasks" ? (
          <>
            <section className="nt-filter-bar nt-panel">
              <label><span>Search</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search tasks" /></label>
              <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">All</option><option value="todo">To Do</option><option value="in progress">In Progress</option><option value="done">Done</option></select></label>
              <label><span>Type</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="all">All</option><option value="task">Task</option><option value="habit">Habit</option><option value="meeting">Meeting</option></select></label>
            </section>

            <section className="nt-kanban-grid">
              {(["todo", "in progress", "done"] as Status[]).map((status) => (
                <article
                  key={status}
                  className={`nt-panel nt-kanban-column ${dropStatus === status ? "is-drop" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropStatus(status);
                  }}
                  onDragLeave={() => setDropStatus((current) => (current === status ? null : current))}
                  onDrop={() => void handleDrop(status)}
                >
                  <div className="nt-panel-head"><span className="nt-label">{titleCase(status)}</span><h2>{filteredItems.filter((item) => item.status === status).length}</h2></div>
                  <div className="nt-kanban-stack">
                    {filteredItems.filter((item) => item.status === status).map((item) => (
                      <article
                        key={item.id}
                        className={`nt-kanban-card ${draggedId === item.id ? "is-dragging" : ""}`}
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDropStatus(null);
                        }}
                        onDoubleClick={() => openEditModal(item)}
                      >
                        <div className="nt-card-top">
                          <span className={`nt-priority nt-priority-${item.priority}`}>{titleCase(item.priority)}</span>
                          <span className={`nt-tag nt-tag-${item.item_type}`}>{titleCase(item.item_type)}</span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                        <div className="nt-card-meta"><span>{item.category}</span><span>{formatDateTime(item.scheduled_for)}</span></div>
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </section>

            <section className="nt-panel nt-table-panel">
              <div className="nt-panel-head"><span className="nt-label">All items</span><h2>Task list</h2></div>
              <div className="nt-table-wrap">
                <table>
                  <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Schedule</th><th>Duration</th></tr></thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr key={item.id} onDoubleClick={() => openEditModal(item)}>
                        <td><div className="nt-table-title"><strong>{item.title}</strong><span>{item.category}</span></div></td>
                        <td>{titleCase(item.item_type)}</td>
                        <td>{titleCase(item.status)}</td>
                        <td>{formatDateTime(item.scheduled_for)}</td>
                        <td>{item.duration} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        {page === "schedule" ? (
          <section className="nt-grid nt-grid-schedule">
            <article className="nt-panel nt-calendar-panel">
              <div className="nt-calendar-top">
                <button className="nt-button nt-button-muted" type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>Prev</button>
                <h2>{calendarMonth.toLocaleString("en-IN", { month: "long", year: "numeric" })}</h2>
                <button className="nt-button nt-button-muted" type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>Next</button>
              </div>
              <div className="nt-calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <div key={label} className="nt-weekday">{label}</div>)}
                {days.map((day) => {
                  const iso = toDateInput(day);
                  const dayItems = items.filter((item) => item.scheduled_for && toDateInput(new Date(item.scheduled_for)) === iso);
                  return (
                    <button key={iso} className={`nt-day ${selectedDate === iso ? "is-selected" : ""}`} type="button" onClick={() => setSelectedDate(iso)}>
                      <span>{day.getDate()}</span>
                      <div className="nt-day-events">
                        {dayItems.slice(0, 2).map((item) => <small key={item.id}>{item.title}</small>)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </article>
            <article className="nt-panel">
              <div className="nt-panel-head"><span className="nt-label">Selected day</span><h2>{selectedDate}</h2></div>
              <div className="nt-list">
                {selectedDayItems.map((item) => (
                  <button key={item.id} className="nt-row-card" type="button" onClick={() => openEditModal(item)}>
                    <div><strong>{item.title}</strong><span>{formatTime(item.scheduled_for)} • {item.duration} min</span></div>
                    <span className={`nt-tag nt-tag-${item.item_type}`}>{titleCase(item.item_type)}</span>
                  </button>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {page === "analytics" && analytics ? (
          <section className="nt-grid nt-grid-analytics">
            <article className="nt-panel nt-score-panel">
              <div className="nt-panel-head"><span className="nt-label">Score</span><h2>{analytics.productivity_score}/100</h2></div>
              <div className="nt-score-ring"><span>{analytics.productivity_score}</span></div>
            </article>
            <article className="nt-panel">
              <div className="nt-panel-head"><span className="nt-label">Categories</span><h2>Distribution</h2></div>
              <div className="nt-bars">
                {analytics.tasks_by_category.map((entry) => (
                  <div key={entry.category} className="nt-bar-row">
                    <div className="nt-bar-label"><strong>{entry.category}</strong><span>{entry.count}</span></div>
                    <div className="nt-rail"><div className="nt-rail-fill" style={{ width: `${(entry.count / Math.max(analytics.tasks_by_category[0]?.count ?? 1, 1)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </article>
            <article className="nt-panel">
              <div className="nt-panel-head"><span className="nt-label">Types</span><h2>Breakdown</h2></div>
              <div className="nt-type-grid">
                {analytics.tasks_by_type.map((entry) => (
                  <div key={entry.type} className="nt-type-card"><strong>{entry.count}</strong><span>{titleCase(entry.type)}</span></div>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {page === "reports" && reports ? (
          <section className="nt-report-grid">
            {(["daily", "weekly", "monthly"] as Array<keyof typeof reports>).map((period) => (
              <article key={period} className="nt-panel nt-report-card">
                <div className="nt-panel-head"><span className="nt-label">{titleCase(period)}</span><h2>{reports[period].metrics.completion_rate}% complete</h2></div>
                <p>{reports[period].summary}</p>
                <div className="nt-report-metrics">
                  <div><strong>{reports[period].metrics.completed}</strong><span>Completed</span></div>
                  <div><strong>{reports[period].metrics.pending}</strong><span>Pending</span></div>
                  <div><strong>{reports[period].metrics.overdue}</strong><span>Overdue</span></div>
                  <div><strong>{reports[period].metrics.meetings}</strong><span>Meetings</span></div>
                </div>
                <div className="nt-chip-row">
                  {reports[period].highlights.map((entry) => <span key={entry.category} className="nt-chip">{entry.category}: {entry.count}</span>)}
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {loading ? <div className="nt-loading">Loading Neuro Tracker...</div> : null}
      </section>

      {modalOpen ? (
        <div className="nt-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="nt-modal" onClick={(event) => event.stopPropagation()}>
            <div className="nt-panel-head"><span className="nt-label">{editingItem ? "Edit" : "Create"}</span><h2>{editingItem ? "Update item" : "New item"}</h2></div>
            <form className="nt-form" onSubmit={submitForm}>
              <div className="nt-form-grid nt-form-grid-2">
                <label><span>Title</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required /></label>
                <label><span>Category</span><input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label>
              </div>
              <label><span>Description</span><textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <div className="nt-form-grid nt-form-grid-4">
                <label><span>Type</span><select value={form.item_type} onChange={(event) => setForm((current) => ({ ...current, item_type: event.target.value as ItemType }))}><option value="task">Task</option><option value="habit">Habit</option><option value="meeting">Meeting</option></select></label>
                <label><span>Priority</span><select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as Priority }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                <label><span>Status</span><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Status }))}><option value="todo">To Do</option><option value="in progress">In Progress</option><option value="done">Done</option></select></label>
                <label><span>Repeat</span><select value={form.repeat_rule} onChange={(event) => setForm((current) => ({ ...current, repeat_rule: event.target.value as RepeatRule }))}><option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              </div>
              <div className="nt-form-grid nt-form-grid-4">
                <label><span>Date</span><input type="date" value={form.scheduled_date} onChange={(event) => setForm((current) => ({ ...current, scheduled_date: event.target.value }))} /></label>
                <label><span>Time</span><input type="time" value={form.scheduled_time} onChange={(event) => setForm((current) => ({ ...current, scheduled_time: event.target.value }))} /></label>
                <label><span>Duration</span><input type="number" min={5} step={5} value={form.duration} onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))} /></label>
                <label><span>Notes</span><input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              </div>
              <div className="nt-modal-actions">
                {editingItem ? <button className="nt-button nt-button-muted" type="button" onClick={() => void deleteItem(editingItem)}>Delete</button> : <span />}
                <div className="nt-actions">
                  <button className="nt-button nt-button-muted" type="button" onClick={() => setModalOpen(false)}>Cancel</button>
                  <button className="nt-button nt-button-solid" type="submit">Save</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? <div className="nt-toast">{toast}</div> : null}
    </main>
  );
}
