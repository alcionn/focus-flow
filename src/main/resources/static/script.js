"use strict";

/* =====================================================================
   FocusFlow frontend
   Sections:
   1. Config & state
   2. Small helpers (dates, formatting, icons)
   3. API calls
   4. Analysis + recommendation engine
   5. Views: dashboard, insights, history, log wizard
   6. Dialogs, toasts, events, startup
   ===================================================================== */

/* ---------- 1. Config & state ---------- */

const API_URL = "/api/activities";

const CATEGORIES = {
    study: {
        label: "Study", icon: "i-book", productive: true,
        blurb: "Lectures, revision, assignments",
        suggestions: ["Revise notes", "Practice problems", "Read a chapter", "Assignment work"]
    },
    coding: {
        label: "Coding", icon: "i-code", productive: true,
        blurb: "Projects, DSA, debugging",
        suggestions: ["Spring Boot practice", "DSA problems", "Side project", "Debugging"]
    },
    exercise: {
        label: "Exercise", icon: "i-dumbbell", productive: true,
        blurb: "Gym, walk, sport, yoga",
        suggestions: ["Gym", "Walk or run", "Yoga", "Sports"]
    },
    entertainment: {
        label: "Entertainment", icon: "i-gamepad", productive: false,
        blurb: "Games, videos, scrolling",
        suggestions: ["Gaming", "YouTube", "Movie or series", "Scrolling"]
    },
    sleep: {
        label: "Sleep", icon: "i-moon", productive: false,
        blurb: "Night sleep and naps",
        suggestions: ["Night sleep", "Nap"]
    },
    other: {
        label: "Other", icon: "i-dots", productive: false,
        blurb: "Chores, meals, commute",
        suggestions: ["Chores", "Meal", "Commute", "Time with friends"]
    }
};

const CAT_ORDER = ["study", "coding", "exercise", "entertainment", "sleep", "other"];
// Order used when stacking bars: productive first so they line up with the goal line.
const STACK_ORDER = ["study", "coding", "exercise", "entertainment", "other"];
const PRODUCTIVE = CAT_ORDER.filter(c => CATEGORIES[c].productive);

const FOCUS_LABELS = ["Scattered", "Distracted", "Okay", "Focused", "Deep focus"];
const VIEWS = ["dashboard", "log", "insights", "history"];
const TITLES = {
    dashboard: "Dashboard", log: "Log activity", insights: "Insights", history: "History"
};
const STEPS = ["Type", "Details", "Time", "Review"];

const state = {
    activities: [],
    an: null,
    loaded: false,
    error: false,
    view: "dashboard",
    settings: loadSettings(),
    filters: { q: "", range: "30", cat: "all" },
    wizard: freshWizard(),
    pendingDeleteId: null
};

function freshWizard() {
    return {
        step: 1, done: false, saving: false, editingId: null,
        data: { category: null, name: "", date: todayIso(), duration: 0, focus: null, notes: "" },
        result: null
    };
}

/* ---------- 2. Helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// (function declarations on purpose: they are hoisted, so `state` above can use them)
function pad(n) { return String(n).padStart(2, "0"); }
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function todayIso() { return iso(new Date()); }

function dayLabel(dateIso) {
    const t = todayIso();
    if (dateIso === t) return "Today";
    if (dateIso === iso(addDays(new Date(), -1))) return "Yesterday";
    return fromIso(dateIso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function fmt(min) {
    min = Math.round(min);
    if (min <= 0) return "0m";
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
}

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function icon(id, cls = "") {
    return `<svg class="icon ${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
}

function cat(key) { return CATEGORIES[key] || CATEGORIES.other; }

function catChip(key) {
    return `<span class="catchip" style="--c:var(--c-${key in CATEGORIES ? key : "other"})">${icon(cat(key).icon)}</span>`;
}

function pct(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : 0; }

function loadSettings() {
    const defaults = { name: "", goal: 240 };
    try {
        const saved = JSON.parse(localStorage.getItem("focusflow.settings") || "{}");
        return { ...defaults, ...saved };
    } catch { return defaults; }
}

function saveSettings() {
    try { localStorage.setItem("focusflow.settings", JSON.stringify(state.settings)); } catch { /* ignore */ }
}

// The backend may send the date as "2026-10-03" or as [2026,10,3]. Handle both.
function normalizeDate(v) {
    if (Array.isArray(v)) return `${v[0]}-${pad(v[1])}-${pad(v[2])}`;
    if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
    return todayIso(); // old rows without a date count as today
}

function normalize(a) {
    const key = String(a.category || "other").toLowerCase();
    return {
        id: a.id,
        name: a.name || "Untitled",
        category: key in CATEGORIES ? key : "other",
        duration: Number(a.duration) || 0,
        date: normalizeDate(a.activityDate),
        focus: a.focusRating ?? null,
        notes: a.notes || ""
    };
}

/* ---------- 3. API ---------- */

async function apiError(res) {
    try {
        const j = await res.json();
        return j.message || j.error || `Request failed (${res.status})`;
    } catch { return `Request failed (${res.status})`; }
}

async function loadActivities() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(await apiError(res));
        const raw = await res.json();
        state.activities = raw.map(normalize)
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        state.an = analyze(state.activities);
        state.error = false;
        hideBanner();
    } catch (err) {
        console.error("Could not load activities:", err);
        state.error = true;
        state.an = analyze([]);
        showBanner("Can't reach the FocusFlow server. Check that the Spring Boot app and MySQL are running, then retry.");
    }
    state.loaded = true;
    renderAll();
}

async function saveActivity() {
    const w = state.wizard;
    const d = w.data;
    const payload = {
        name: d.name.trim(),
        category: d.category,
        duration: d.duration,
        activityDate: d.date,
        focusRating: d.category === "sleep" ? null : d.focus,
        notes: d.notes.trim() || null
    };
    const editing = w.editingId != null;

    w.saving = true;
    renderWizard();
    try {
        const res = await fetch(editing ? `${API_URL}/${w.editingId}` : API_URL, {
            method: editing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await apiError(res));
        await loadActivities();
        w.saving = false;
        w.done = true;
        w.result = { editing, name: payload.name, duration: payload.duration, date: payload.activityDate };
        renderWizard();
    } catch (err) {
        w.saving = false;
        renderWizard();
        toast(err.message || "Could not save the activity.", "error");
    }
}

async function deleteActivity(id) {
    try {
        const res = await fetch(`${API_URL}/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await apiError(res));
        toast("Activity deleted.");
        await loadActivities();
    } catch (err) {
        toast(err.message || "Could not delete the activity.", "error");
    }
}

/* ---------- 4. Analysis + recommendations ---------- */

function analyze(list) {
    const byDate = new Map();
    const blank = date => ({ date, total: 0, awake: 0, productive: 0, sleep: 0, byCat: {}, items: [] });

    list.forEach(a => {
        if (!byDate.has(a.date)) byDate.set(a.date, blank(a.date));
        const d = byDate.get(a.date);
        d.total += a.duration;
        d.byCat[a.category] = (d.byCat[a.category] || 0) + a.duration;
        d.items.push(a);
        if (a.category === "sleep") d.sleep += a.duration; else d.awake += a.duration;
        if (PRODUCTIVE.includes(a.category)) d.productive += a.duration;
    });

    const day = date => byDate.get(date) || blank(date);
    const lastDays = n => Array.from({ length: n }, (_, i) => iso(addDays(new Date(), i - (n - 1))));
    const today = todayIso();
    const days14 = lastDays(14);
    const w7 = days14.slice(7);
    const prev7 = days14.slice(0, 7);
    const sum = (dates, key) => dates.reduce((s, d) => s + day(d)[key], 0);

    // category totals over the last 7 days (awake time only)
    const cat7 = {};
    w7.forEach(d => Object.entries(day(d).byCat).forEach(([c, m]) => {
        if (c !== "sleep") cat7[c] = (cat7[c] || 0) + m;
    }));
    const awake7 = sum(w7, "awake");
    const productive7 = sum(w7, "productive");
    const productivePrev7 = sum(prev7, "productive");

    // streak = consecutive days with productive time, ending today (or yesterday)
    const yesterday = iso(addDays(new Date(), -1));
    const hasToday = day(today).productive > 0;
    let cursor = hasToday ? new Date() : addDays(new Date(), -1);
    let streak = 0;
    while (day(iso(cursor)).productive > 0) { streak++; cursor = addDays(cursor, -1); }
    const streakInfo = { count: streak, atRisk: !hasToday && streak > 0 && day(yesterday).productive > 0 };

    // sleep
    const sleepNights = w7.filter(d => day(d).sleep > 0);
    const avgSleep = sleepNights.length ? sum(sleepNights, "sleep") / sleepNights.length : null;

    // focus ratings (last 7 days)
    const rated = w7.flatMap(d => day(d).items).filter(a => a.focus != null);
    const avgFocus = rated.length ? rated.reduce((s, a) => s + a.focus, 0) / rated.length : null;

    // days since last exercise
    const exerciseDates = [...byDate.values()].filter(d => (d.byCat.exercise || 0) > 0).map(d => d.date).sort();
    const lastExercise = exerciseDates[exerciseDates.length - 1];
    const daysSinceExercise = lastExercise
        ? Math.round((fromIso(today) - fromIso(lastExercise)) / 86400000) : null;

    // longest non-sleep session in last 7 days
    const longest = w7.flatMap(d => day(d).items)
        .filter(a => a.category !== "sleep")
        .reduce((best, a) => (!best || a.duration > best.duration ? a : best), null);

    // weekday pattern (all data): average productive minutes by weekday
    const wd = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    byDate.forEach(d => { const i = fromIso(d.date).getDay(); wd[i].sum += d.productive; wd[i].n++; });
    const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = [1, 2, 3, 4, 5, 6, 0].map(i => ({
        name: weekdayNames[i], avg: wd[i].n ? wd[i].sum / wd[i].n : 0, n: wd[i].n
    }));
    const bestWeekday = weekday.filter(w => w.n > 0).reduce((b, w) => (!b || w.avg > b.avg ? w : b), null);

    const topProductiveCat = PRODUCTIVE
        .map(c => [c, cat7[c] || 0]).sort((a, b) => b[1] - a[1])[0];

    return {
        byDate, day, lastDays, today, w7, awake7, productive7, productivePrev7, cat7,
        prod7: pct(productive7, awake7),
        streak: streakInfo, avgSleep, sleepNights: sleepNights.length,
        avgFocus, ratedCount: rated.length,
        daysSinceExercise, longest, weekday, bestWeekday,
        trackedDays: byDate.size,
        activeDays7: w7.filter(d => day(d).total > 0).length,
        topProductiveCat: topProductiveCat && topProductiveCat[1] > 0 ? topProductiveCat[0] : "study"
    };
}

function buildRecommendations(an) {
    const r = [];
    const goal = state.settings.goal;
    const t = an.day(an.today);

    if (!state.activities.length) {
        return [{
            id: "first", tone: "info", icon: "i-sparkle", priority: 100,
            title: "Log your first activity",
            text: "It takes about 20 seconds. Insights and recommendations appear after a few entries.",
            action: { label: "Start logging" }
        }];
    }

    const best = an.topProductiveCat;
    const bestLabel = cat(best).label.toLowerCase();

    // Today's goal
    if (t.productive >= goal) {
        r.push({
            id: "goal-done", tone: "good", icon: "i-check", priority: 40,
            title: "Daily goal reached",
            text: `You've put in ${fmt(t.productive)} today. Anything extra is a bonus, and rest counts too.`
        });
    } else {
        r.push({
            id: "goal", tone: "info", icon: "i-target", priority: 90,
            title: `${fmt(goal - t.productive)} left for today's goal`,
            text: t.total === 0
                ? "Nothing logged yet today. One focused 25-minute block is a good start."
                : "Split it into two or three focused blocks with short breaks in between.",
            action: { label: `Log 25 min of ${bestLabel}`, cat: best, name: "Focus block", duration: 25 }
        });
    }

    // Streak
    if (an.streak.atRisk) {
        r.push({
            id: "streak", tone: "warn", icon: "i-flame", priority: 95,
            title: `Keep your ${an.streak.count}-day streak alive`,
            text: "You haven't logged any productive time today. Even 15 minutes keeps it going.",
            action: { label: "Log 15 min", cat: best, name: "Quick session", duration: 15 }
        });
    } else if (an.streak.count >= 3) {
        r.push({
            id: "streak-good", tone: "good", icon: "i-flame", priority: 45,
            title: `${an.streak.count}-day streak`,
            text: "You've logged productive time every day. Consistency beats intensity."
        });
    }

    // Entertainment share
    const ent = an.cat7.entertainment || 0;
    if (an.awake7 >= 120 && ent / an.awake7 >= 0.3) {
        r.push({
            id: "ent", tone: "warn", icon: "i-gamepad", priority: 80,
            title: `Entertainment is ${pct(ent, an.awake7)}% of your awake time`,
            text: "That's over a quarter of the week. Trade one session for a walk or a short study block.",
            action: { label: "Log a 20 min walk", cat: "exercise", name: "Walk", duration: 20 }
        });
    }

    // Exercise gap
    if (state.activities.length >= 3 &&
        (an.daysSinceExercise === null || an.daysSinceExercise >= 3)) {
        r.push({
            id: "exercise", tone: "info", icon: "i-dumbbell", priority: 70,
            title: an.daysSinceExercise === null
                ? "No exercise logged yet"
                : `No exercise for ${an.daysSinceExercise} days`,
            text: "A 20-minute walk improves focus for the next few hours of study.",
            action: { label: "Log a 20 min walk", cat: "exercise", name: "Walk", duration: 20 }
        });
    }

    // Sleep
    if (an.avgSleep !== null) {
        if (an.avgSleep < 390) {
            r.push({
                id: "sleep-low", tone: "warn", icon: "i-moon", priority: 85,
                title: `You're averaging ${fmt(an.avgSleep)} of sleep`,
                text: "Most people need 7 to 9 hours. Short sleep hurts memory and focus more than extra study helps."
            });
        } else if (an.avgSleep >= 420) {
            r.push({
                id: "sleep-good", tone: "good", icon: "i-moon", priority: 35,
                title: `Healthy sleep: ${fmt(an.avgSleep)} on average`,
                text: "Good rest is the base for everything else on this dashboard."
            });
        }
    } else if (an.trackedDays >= 3) {
        r.push({
            id: "sleep-track", tone: "info", icon: "i-moon", priority: 30,
            title: "Track your sleep too",
            text: "Logging sleep shows how rest affects your focus ratings.",
            action: { label: "Log 8h sleep", cat: "sleep", name: "Night sleep", duration: 480 }
        });
    }

    // Long sessions
    if (an.longest && an.longest.duration > 120) {
        r.push({
            id: "long", tone: "info", icon: "i-clock", priority: 60,
            title: `${fmt(an.longest.duration)} in one go: ${an.longest.name}`,
            text: "Sessions past two hours usually lose quality. Try 50 minutes on, 10 minutes off."
        });
    }

    // Focus rating
    if (an.avgFocus !== null && an.ratedCount >= 3) {
        if (an.avgFocus <= 2.5) {
            r.push({
                id: "focus-low", tone: "warn", icon: "i-target", priority: 75,
                title: `Focus is averaging ${an.avgFocus.toFixed(1)} out of 5`,
                text: "Try shorter 25-minute blocks, phone out of reach, one task at a time.",
                action: { label: "Log 25 min of " + bestLabel, cat: best, name: "Pomodoro", duration: 25 }
            });
        } else if (an.avgFocus >= 4) {
            r.push({
                id: "focus-high", tone: "good", icon: "i-target", priority: 42,
                title: `Strong focus: ${an.avgFocus.toFixed(1)} out of 5`,
                text: "Whatever you're doing right now is working. Keep the same routine."
            });
        }
    }

    // Week vs previous week
    if (an.productivePrev7 > 0) {
        const change = Math.round((an.productive7 - an.productivePrev7) / an.productivePrev7 * 100);
        if (change >= 15) {
            r.push({
                id: "wow-up", tone: "good", icon: "i-trend-up", priority: 50,
                title: `Productive time is up ${change}% on last week`,
                text: `${fmt(an.productive7)} this week against ${fmt(an.productivePrev7)} last week.`
            });
        } else if (change <= -25) {
            r.push({
                id: "wow-down", tone: "warn", icon: "i-trend-down", priority: 78,
                title: `Productive time is down ${Math.abs(change)}% on last week`,
                text: `${fmt(an.productive7)} this week against ${fmt(an.productivePrev7)} last week. Pick one fixed daily slot to rebuild the habit.`
            });
        }
    }

    // Overall productivity
    if (an.awake7 >= 120) {
        if (an.prod7 >= 70) {
            r.push({
                id: "prod-high", tone: "good", icon: "i-trend-up", priority: 48,
                title: `${an.prod7}% of your awake time is productive`,
                text: "That's a strong balance. Schedule real downtime so it stays sustainable."
            });
        } else if (an.prod7 < 40) {
            r.push({
                id: "prod-low", tone: "warn", icon: "i-alert", priority: 72,
                title: `Only ${an.prod7}% of awake time was productive`,
                text: "Block one fixed focus slot each day and protect it before anything else."
            });
        }
    }

    // Consistency
    if (an.trackedDays >= 3 && an.activeDays7 <= 2) {
        r.push({
            id: "consistency", tone: "info", icon: "i-calendar", priority: 65,
            title: `Only ${an.activeDays7} of the last 7 days have entries`,
            text: "Logging a quick entry each day makes every insight on this page more accurate."
        });
    }

    // Best weekday
    if (an.trackedDays >= 5 && an.bestWeekday && an.bestWeekday.avg > 0) {
        const nWeekdays = an.weekday.filter(w => w.n > 0).length;
        if (nWeekdays >= 3) {
            r.push({
                id: "weekday", tone: "info", icon: "i-calendar", priority: 20,
                title: `${an.bestWeekday.name} is your most productive day`,
                text: `You average ${fmt(an.bestWeekday.avg)} of productive time on ${an.bestWeekday.name}s. Put your hardest work there.`
            });
        }
    }

    return r.sort((a, b) => b.priority - a.priority);
}

/* ---------- 5. Views ---------- */

function renderAll() {
    VIEWS.forEach(v => { $("#view-" + v).hidden = v !== state.view; });
    $$("[data-nav]").forEach(a => {
        const on = a.dataset.nav === state.view;
        a.classList.toggle("is-active", on);
        if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("#pageTitle").textContent = TITLES[state.view];
    document.title = `${TITLES[state.view]} | FocusFlow`;
    $("#topLog").hidden = state.view === "log";

    ({ dashboard: renderDashboard, log: renderWizard, insights: renderInsights, history: renderHistory })[state.view]();
}

function loadingPanel() {
    return `<div class="empty"><p class="muted">Loading your activity…</p></div>`;
}

function errorPanel() {
    return `
        <div class="empty">
            <img src="img/empty.svg" alt="" width="160" height="112">
            <h2>Couldn't load your data</h2>
            <p class="muted">The server didn't respond. Make sure Spring Boot and MySQL are running.</p>
            <button class="btn btn--primary" type="button" data-action="retry">Try again</button>
        </div>`;
}

function emptyPanel(title, text) {
    return `
        <div class="empty">
            <img src="img/empty.svg" alt="" width="160" height="112">
            <h2>${esc(title)}</h2>
            <p class="muted">${esc(text)}</p>
            <button class="btn btn--primary" type="button" data-action="new-log">${icon("i-plus")}Log activity</button>
        </div>`;
}

/* ----- Dashboard ----- */

function greeting() {
    const h = new Date().getHours();
    const part = h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    return state.settings.name ? `${part}, ${state.settings.name}` : part;
}

function renderDashboard() {
    const el = $("#view-dashboard");
    if (!state.loaded) { el.innerHTML = loadingPanel(); return; }
    if (state.error) { el.innerHTML = errorPanel(); return; }

    const an = state.an;
    const t = an.day(an.today);
    const goal = state.settings.goal;
    const goalPct = Math.min(100, pct(t.productive, goal));
    const reco = buildRecommendations(an).slice(0, 3);
    const recent = state.activities.slice(0, 4);

    el.innerHTML = `
        ${heroHtml(t, goal, goalPct)}
        ${statsHtml(an, t, goalPct)}

        <div class="grid grid--chart">
            <section class="panel" aria-labelledby="weekTitle">
                <div class="panel__head">
                    <h2 id="weekTitle">This week</h2>
                    <span class="muted">Awake time by day</span>
                </div>
                ${weekChartHtml(an, goal)}
            </section>

            <section class="panel" aria-labelledby="splitTitle">
                <div class="panel__head">
                    <h2 id="splitTitle">Where your time went</h2>
                    <span class="muted">Last 7 days</span>
                </div>
                ${donutHtml(an)}
            </section>
        </div>

        <div class="grid grid--two">
            <section class="panel" aria-labelledby="recoTitle">
                <div class="panel__head">
                    <h2 id="recoTitle">Recommended for you</h2>
                    <a class="link" href="#insights">All insights</a>
                </div>
                <div class="reco-list">${reco.map(recoHtml).join("")}</div>
            </section>

            <section class="panel" aria-labelledby="recentTitle">
                <div class="panel__head">
                    <h2 id="recentTitle">Recent activity</h2>
                    <a class="link" href="#history">View all</a>
                </div>
                ${recent.length
                    ? `<ul class="recent">${recent.map(a => `
                        <li class="recent__item">
                            ${catChip(a.category)}
                            <div class="recent__main">
                                <strong>${esc(a.name)}</strong>
                                <span class="muted">${esc(dayLabel(a.date))}</span>
                            </div>
                            <span class="recent__time">${fmt(a.duration)}</span>
                        </li>`).join("")}</ul>`
                    : `<p class="muted">Nothing logged yet.</p>`}
            </section>
        </div>`;
}

function heroHtml(t, goal, goalPct) {
    const scale = Math.max(goal, t.awake);
    const segs = STACK_ORDER.filter(c => (t.byCat[c] || 0) > 0);
    const goalLeft = goal / scale * 100;

    let headline, sub;
    if (t.total === 0) {
        headline = "Nothing logged yet today";
        sub = "Log your first block and it will appear on the ribbon below.";
    } else if (t.productive >= goal) {
        headline = `${fmt(t.productive)} productive today`;
        sub = "Goal reached. Nice work.";
    } else {
        headline = `${fmt(t.productive)} productive so far`;
        sub = `${fmt(goal - t.productive)} to go for your ${fmt(goal)} goal.`;
    }

    const ribbon = segs.length
        ? `<div class="ribbon" role="img" aria-label="Today by category: ${segs.map(c => `${cat(c).label} ${fmt(t.byCat[c])}`).join(", ")}">
            ${segs.map(c => {
                const w = t.byCat[c] / scale * 100;
                return `<div class="ribbon__seg ${w >= 14 ? "is-wide" : ""}" style="--w:${w}%;--c:var(--cb-${c})" title="${cat(c).label}: ${fmt(t.byCat[c])}">
                    ${icon(cat(c).icon)}<span>${fmt(t.byCat[c])}</span></div>`;
            }).join("")}
            <span class="ribbon__goal ${goalLeft > 80 ? "is-right" : ""}" style="--left:${goalLeft}%"><em>Goal ${fmt(goal)}</em></span>
        </div>`
        : `<div class="ribbon ribbon--empty"><span>Your day appears here as colored blocks</span>
            <span class="ribbon__goal is-right" style="--left:100%"><em>Goal ${fmt(goal)}</em></span></div>`;

    return `
        <section class="hero" aria-label="Today">
            <div class="hero__text">
                <p class="hero__hello">${esc(greeting())}</p>
                <p class="hero__big">${esc(headline)}</p>
                <p class="hero__sub">${esc(sub)}</p>
                <div class="hero__ribbon">${ribbon}</div>
                <div class="hero__actions">
                    <button class="btn btn--light" type="button" data-action="new-log">${icon("i-plus")}Log activity</button>
                    <button class="btn btn--outline-light" type="button" data-action="settings">Change goal</button>
                </div>
            </div>
            <img class="hero__art" src="img/hero.svg" alt="" width="260" height="178">
        </section>`;
}

function statsHtml(an, t, goalPct) {
    const focusText = an.avgFocus === null ? "—" : `${an.avgFocus.toFixed(1)}/5`;
    const focusSub = an.avgFocus === null ? "Rate sessions to track this"
        : FOCUS_LABELS[Math.min(4, Math.max(0, Math.round(an.avgFocus) - 1))];
    const items = [
        { icon: "i-target", label: "Today's goal", value: `${goalPct}%`, sub: `${fmt(t.productive)} of ${fmt(state.settings.goal)}` },
        { icon: "i-trend-up", label: "Productivity", value: an.awake7 ? `${an.prod7}%` : "—", sub: "of awake time, 7 days" },
        { icon: "i-flame", label: "Streak", value: `${an.streak.count} ${an.streak.count === 1 ? "day" : "days"}`, sub: an.streak.atRisk ? "Log today to keep it" : "productive days in a row" },
        { icon: "i-clock", label: "Average focus", value: focusText, sub: focusSub }
    ];
    return `<section class="strip" aria-label="Key numbers">${items.map(i => `
        <div class="strip__item">
            <span class="strip__label">${icon(i.icon)}${esc(i.label)}</span>
            <strong class="strip__value">${esc(i.value)}</strong>
            <span class="strip__sub">${esc(i.sub)}</span>
        </div>`).join("")}</section>`;
}

function niceMax(value) {
    const steps = [30, 60, 120, 180, 240, 360, 480, 600, 720];
    const step = steps.find(s => value / s <= 4) || 720;
    return { step, max: Math.max(step, Math.ceil(value / step) * step) };
}

function weekChartHtml(an, goal) {
    const dates = an.lastDays(7);
    const peak = Math.max(goal, ...dates.map(d => an.day(d).awake));
    const { step, max } = niceMax(peak * 1.05);

    const W = 560, H = 280, L = 38, R = 8, T = 14, B = 30;
    const plotW = W - L - R, plotH = H - T - B;
    const slot = plotW / 7, barW = Math.min(46, slot - 14);
    const y = m => T + plotH - (m / max) * plotH;

    let grid = "";
    for (let m = 0; m <= max; m += step) {
        grid += `<line class="chart__grid" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/>
                 <text class="chart__tick" x="${L - 8}" y="${y(m) + 4}" text-anchor="end">${m / 60}h</text>`;
    }

    const bars = dates.map((d, i) => {
        const data = an.day(d);
        const x = L + i * slot + (slot - barW) / 2;
        let acc = 0;
        const parts = STACK_ORDER.filter(c => (data.byCat[c] || 0) > 0).map(c => {
            const h = (data.byCat[c] / max) * plotH;
            const top = T + plotH - ((acc + data.byCat[c]) / max) * plotH;
            acc += data.byCat[c];
            return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" style="fill:var(--c-${c})"/>`;
        }).join("");
        const label = d === an.today ? "Today"
            : fromIso(d).toLocaleDateString("en-IN", { weekday: "short" });
        const tip = `${dayLabel(d)}: ${fmt(data.awake)} awake, ${fmt(data.productive)} productive`;
        const barH = (data.awake / max) * plotH;
        return `
            <g>
                <title>${esc(tip)}</title>
                ${data.awake > 0 ? `<clipPath id="clip${i}"><rect x="${x}" y="${y(data.awake)}" width="${barW}" height="${barH}" rx="7"/></clipPath>
                <g clip-path="url(#clip${i})">${parts}</g>` : `<rect class="chart__zero" x="${x}" y="${T + plotH - 3}" width="${barW}" height="3" rx="1.5"/>`}
                <text class="chart__day ${d === an.today ? "is-today" : ""}" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${label}</text>
            </g>`;
    }).join("");

    const goalY = y(goal);
    const summary = dates.map(d => `${dayLabel(d)} ${fmt(an.day(d).awake)}`).join(", ");

    return `
        <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Awake time per day for the last 7 days. ${esc(summary)}">
            ${grid}
            ${bars}
            <line class="chart__goal" x1="${L}" x2="${W - R}" y1="${goalY}" y2="${goalY}"/>
            <text class="chart__goaltext" x="${W - R}" y="${goalY - 6}" text-anchor="end">Goal ${fmt(goal)}</text>
        </svg>
        <ul class="legend">${STACK_ORDER.map(c => `<li><i style="background:var(--c-${c})"></i>${cat(c).label}</li>`).join("")}</ul>`;
}

function donutHtml(an) {
    const entries = STACK_ORDER.map(c => [c, an.cat7[c] || 0]).filter(e => e[1] > 0);
    const total = entries.reduce((s, e) => s + e[1], 0);
    if (!total) {
        return `<p class="muted">Log some activities and the breakdown appears here.</p>`;
    }
    const R = 54, C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = entries.map(([c, m]) => {
        const len = m / total * C;
        const arc = `<circle cx="70" cy="70" r="${R}" fill="none" stroke-width="18"
            style="stroke:var(--c-${c})" stroke-dasharray="${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}"
            stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${cat(c).label}: ${fmt(m)}</title></circle>`;
        offset += len;
        return arc;
    }).join("");

    return `
        <div class="donut">
            <svg viewBox="0 0 140 140" class="donut__svg" role="img" aria-label="Time split by category">
                <circle cx="70" cy="70" r="${R}" fill="none" stroke-width="18" class="donut__track"/>
                ${arcs}
                <text x="70" y="68" text-anchor="middle" class="donut__num">${fmt(total)}</text>
                <text x="70" y="86" text-anchor="middle" class="donut__cap">awake</text>
            </svg>
            <ul class="split">${entries.sort((a, b) => b[1] - a[1]).map(([c, m]) => `
                <li>
                    <span class="split__name">${catChip(c)}${cat(c).label}</span>
                    <span class="split__val">${fmt(m)} <small>${pct(m, total)}%</small></span>
                </li>`).join("")}</ul>
        </div>`;
}

function recoHtml(r) {
    const action = r.action
        ? `<button class="btn btn--soft" type="button" data-action="reco"
              data-cat="${esc(r.action.cat || "")}" data-name="${esc(r.action.name || "")}" data-dur="${r.action.duration || 0}">${esc(r.action.label)}</button>`
        : "";
    return `
        <article class="reco reco--${r.tone}">
            <span class="reco__icon">${icon(r.icon)}</span>
            <div class="reco__body">
                <h3>${esc(r.title)}</h3>
                <p>${esc(r.text)}</p>
                ${action}
            </div>
        </article>`;
}

/* ----- Insights ----- */

function renderInsights() {
    const el = $("#view-insights");
    if (!state.loaded) { el.innerHTML = loadingPanel(); return; }
    if (state.error) { el.innerHTML = errorPanel(); return; }
    if (!state.activities.length) {
        el.innerHTML = emptyPanel("No insights yet", "Log a few activities and FocusFlow will start spotting patterns.");
        return;
    }

    const an = state.an;
    const recos = buildRecommendations(an);
    const change = an.productivePrev7 > 0
        ? Math.round((an.productive7 - an.productivePrev7) / an.productivePrev7 * 100) : null;

    const headline = an.productive7 === 0
        ? "No productive time logged in the last 7 days"
        : change === null
            ? `${fmt(an.productive7)} productive in the last 7 days`
            : `${fmt(an.productive7)} productive this week, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on last week`;

    const maxWeek = Math.max(an.productive7, an.productivePrev7, 1);
    const maxWd = Math.max(...an.weekday.map(w => w.avg), 1);

    // Balance (30 days, awake time)
    const days30 = an.lastDays(30);
    const cat30 = {};
    days30.forEach(d => Object.entries(an.day(d).byCat).forEach(([c, m]) => {
        if (c !== "sleep") cat30[c] = (cat30[c] || 0) + m;
    }));
    const total30 = Object.values(cat30).reduce((s, m) => s + m, 0);

    el.innerHTML = `
        <section class="pagehead">
            <h2>${esc(headline)}</h2>
            <p class="muted">${recos.length} observation${recos.length === 1 ? "" : "s"} based on your last 7 days, ordered by what matters most.</p>
        </section>

        <div class="grid grid--insights">
            <div class="reco-list reco-list--big">${recos.map(recoHtml).join("")}</div>

            <aside class="side-panels">
                <section class="panel">
                    <div class="panel__head"><h2>Week on week</h2></div>
                    <div class="compare">
                        <div class="compare__row">
                            <span>This week</span>
                            <div class="bar"><i style="width:${pct(an.productive7, maxWeek)}%"></i></div>
                            <strong>${fmt(an.productive7)}</strong>
                        </div>
                        <div class="compare__row">
                            <span>Last week</span>
                            <div class="bar bar--muted"><i style="width:${pct(an.productivePrev7, maxWeek)}%"></i></div>
                            <strong>${fmt(an.productivePrev7)}</strong>
                        </div>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel__head"><h2>Best days</h2><span class="muted">Avg productive time</span></div>
                    <ul class="wd">${an.weekday.map(w => `
                        <li class="${an.bestWeekday && w.name === an.bestWeekday.name && w.avg > 0 ? "is-best" : ""}">
                            <div class="wd__bar"><i style="height:${pct(w.avg, maxWd)}%" title="${w.name}: ${fmt(w.avg)}"></i></div>
                            <span>${w.name}</span>
                        </li>`).join("")}</ul>
                </section>

                <section class="panel">
                    <div class="panel__head"><h2>30-day balance</h2><span class="muted">Awake time</span></div>
                    ${total30 ? `
                        <div class="mix" role="img" aria-label="${STACK_ORDER.filter(c => cat30[c]).map(c => `${cat(c).label} ${pct(cat30[c], total30)}%`).join(", ")}">
                            ${STACK_ORDER.filter(c => cat30[c]).map(c => `<i style="flex:${cat30[c]};background:var(--c-${c})" title="${cat(c).label} ${pct(cat30[c], total30)}%"></i>`).join("")}
                        </div>
                        <ul class="legend legend--col">${STACK_ORDER.filter(c => cat30[c]).map(c => `
                            <li><i style="background:var(--c-${c})"></i>${cat(c).label}<span>${pct(cat30[c], total30)}%</span></li>`).join("")}</ul>
                        <p class="muted small">A healthy target is about 50% productive and under 25% entertainment.</p>`
                        : `<p class="muted">No data in the last 30 days.</p>`}
                </section>
            </aside>
        </div>`;
}

/* ----- History ----- */

function filteredActivities() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    const cutoff = f.range === "all" ? null : iso(addDays(new Date(), -(Number(f.range) - 1)));
    return state.activities.filter(a =>
        (f.cat === "all" || a.category === f.cat) &&
        (!cutoff || a.date >= cutoff) &&
        (!q || a.name.toLowerCase().includes(q) || a.notes.toLowerCase().includes(q)));
}

function renderHistory() {
    $$("[data-action='f-range']").forEach(b => {
        const on = b.dataset.value === state.filters.range;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on);
    });
    $("#historyChips").innerHTML = ["all", ...CAT_ORDER].map(c => `
        <button type="button" class="chip ${state.filters.cat === c ? "is-on" : ""}" data-action="f-cat" data-value="${c}" aria-pressed="${state.filters.cat === c}">
            ${c === "all" ? "All" : `<i style="background:var(--c-${c})"></i>${cat(c).label}`}
        </button>`).join("");
    renderHistoryList();
}

function renderHistoryList() {
    const list = $("#historyList");
    if (!state.loaded) { list.innerHTML = loadingPanel(); return; }
    if (state.error) { list.innerHTML = errorPanel(); return; }

    const items = filteredActivities();
    const total = items.reduce((s, a) => s + a.duration, 0);
    $("#historySummary").textContent = items.length
        ? `${items.length} ${items.length === 1 ? "activity" : "activities"}, ${fmt(total)} in total`
        : "";

    if (!items.length) {
        list.innerHTML = state.activities.length
            ? `<div class="empty"><img src="img/empty.svg" alt="" width="160" height="112"><h2>No matches</h2><p class="muted">Try a longer date range or clear the filters.</p></div>`
            : emptyPanel("No activities yet", "Everything you log shows up here, grouped by day.");
        return;
    }

    const groups = new Map();
    items.forEach(a => { if (!groups.has(a.date)) groups.set(a.date, []); groups.get(a.date).push(a); });

    list.innerHTML = [...groups.entries()].map(([date, rows]) => `
        <section class="daygroup">
            <header class="daygroup__head">
                <h2>${esc(dayLabel(date))}</h2>
                <span class="muted">${fmt(rows.reduce((s, a) => s + a.duration, 0))}</span>
            </header>
            <ul class="rows">${rows.map(rowHtml).join("")}</ul>
        </section>`).join("");
}

function rowHtml(a) {
    const focus = a.focus
        ? `<span class="focusdots" title="Focus: ${FOCUS_LABELS[a.focus - 1]}" aria-label="Focus ${a.focus} out of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= a.focus ? "on" : ""}"></i>`).join("")}</span>`
        : "";
    return `
        <li class="row">
            ${catChip(a.category)}
            <div class="row__main">
                <strong>${esc(a.name)}</strong>
                <span class="muted">${esc(cat(a.category).label)}${a.notes ? ` · ${esc(a.notes.length > 60 ? a.notes.slice(0, 60) + "…" : a.notes)}` : ""}</span>
            </div>
            ${focus}
            <span class="row__time">${fmt(a.duration)}</span>
            <div class="row__actions">
                <button type="button" class="iconbtn" data-action="edit" data-id="${a.id}" aria-label="Edit ${esc(a.name)}">${icon("i-edit")}</button>
                <button type="button" class="iconbtn iconbtn--danger" data-action="delete" data-id="${a.id}" aria-label="Delete ${esc(a.name)}">${icon("i-trash")}</button>
            </div>
        </li>`;
}

function exportCsv() {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["date", "name", "category", "minutes", "focus", "notes"]]
        .concat(filteredActivities().map(a => [a.date, a.name, a.category, a.duration, a.focus ?? "", a.notes]));
    const csv = "﻿" + rows.map(r => r.map(q).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `focusflow-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("CSV downloaded.");
}

/* ----- Log wizard (4 steps + done) ----- */

function startWizard(prefill = {}) {
    state.wizard = freshWizard();
    const d = state.wizard.data;
    if (prefill.category) { d.category = prefill.category; }
    if (prefill.name) d.name = prefill.name;
    if (prefill.duration) d.duration = prefill.duration;
    if (prefill.editing) {
        const a = prefill.editing;
        state.wizard.editingId = a.id;
        Object.assign(d, { category: a.category, name: a.name, date: a.date, duration: a.duration, focus: a.focus, notes: a.notes });
        state.wizard.step = 4;
    } else if (prefill.category && prefill.name && prefill.duration) {
        state.wizard.step = 4; // quick-log from a recommendation: just confirm
    } else if (prefill.category) {
        state.wizard.step = 2;
    }
    if (location.hash === "#log") renderAll(); else location.hash = "#log";
}

let lastWizardStep = 0;

function stepValid(step) {
    const d = state.wizard.data;
    if (step === 1) return !!d.category;
    if (step === 2) return d.name.trim().length > 0 && d.name.trim().length <= 100 && !!d.date;
    if (step === 3) return d.duration >= 1 && d.duration <= 1440;
    return true;
}

function renderWizard() {
    const w = state.wizard;
    const body = $("#wizardBody"), foot = $("#wizardFoot"), stepper = $("#stepper");

    if (w.done) {
        stepper.innerHTML = "";
        foot.innerHTML = "";
        const r = w.result;
        const an = state.an;
        const t = an.day(r.date);
        let progress = "";
        if (r.date === an.today) {
            const goal = state.settings.goal;
            progress = `<p>You're at <strong>${fmt(t.productive)}</strong> of your ${fmt(goal)} goal today (${Math.min(100, pct(t.productive, goal))}%).</p>`;
        }
        body.innerHTML = `
            <div class="done">
                <span class="done__tick">${icon("i-check")}</span>
                <h2>${r.editing ? "Changes saved" : "Activity saved"}</h2>
                <p><strong>${esc(r.name)}</strong> · ${fmt(r.duration)} · ${esc(dayLabel(r.date))}</p>
                ${progress}
                <div class="done__actions">
                    <button class="btn btn--primary" type="button" data-action="new-log">${icon("i-plus")}Log another</button>
                    <a class="btn btn--ghost" href="#dashboard">See dashboard</a>
                </div>
            </div>`;
        return;
    }

    // stepper
    stepper.innerHTML = STEPS.map((label, i) => {
        const n = i + 1;
        const cls = n < w.step ? "is-done" : n === w.step ? "is-current" : "";
        const clickable = n < w.step || w.editingId != null;
        return `<li class="stepper__item ${cls}" ${n === w.step ? 'aria-current="step"' : ""}>
            ${clickable ? `<button type="button" class="stepper__dot" data-action="w-goto" data-step="${n}" aria-label="Go to step ${n}: ${label}">${n < w.step ? icon("i-check") : n}</button>`
                        : `<span class="stepper__dot">${n < w.step ? icon("i-check") : n}</span>`}
            <span class="stepper__label">${label}</span>
        </li>`;
    }).join("");

    // only play the slide-in animation when the step actually changes
    const entering = lastWizardStep !== w.step;
    lastWizardStep = w.step;
    body.innerHTML = `<div class="step ${entering ? "step--enter" : ""}">${[null, stepType, stepDetails, stepTime, stepReview][w.step](w)}</div>`;

    // footer
    const last = w.step === 4;
    foot.innerHTML = `
        ${w.step > 1 ? `<button class="btn btn--ghost" type="button" data-action="w-back" ${w.saving ? "disabled" : ""}>${icon("i-arrow-left")}Back</button>` : "<span></span>"}
        ${last
            ? `<button class="btn btn--primary" type="button" data-action="w-save" ${w.saving ? "disabled" : ""}>${w.saving ? "Saving…" : w.editingId != null ? "Save changes" : "Save activity"}</button>`
            : `<button id="wNext" class="btn btn--primary" type="button" data-action="w-next" ${stepValid(w.step) ? "" : "disabled"}>Next${icon("i-arrow-right")}</button>`}`;

    const focusTarget = $("[data-autofocus]", body);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function stepType(w) {
    return `
        <h2>What did you spend time on?</h2>
        <p class="muted">Pick the closest match. You can add the details next.</p>
        <div class="tiles">
            ${CAT_ORDER.map(c => `
                <button type="button" class="tile ${w.data.category === c ? "is-on" : ""}" data-action="w-cat" data-value="${c}" aria-pressed="${w.data.category === c}" style="--c:var(--c-${c})">
                    <span class="tile__icon">${icon(cat(c).icon)}</span>
                    <strong>${cat(c).label}</strong>
                    <small>${cat(c).blurb}</small>
                </button>`).join("")}
        </div>`;
}

function stepDetails(w) {
    const d = w.data;
    const today = todayIso(), yesterday = iso(addDays(new Date(), -1));
    const custom = d.date !== today && d.date !== yesterday;
    return `
        <h2>Describe it</h2>
        <p class="muted">A short name is enough, like "Spring Boot practice".</p>

        <label class="field">
            <span class="field__label">Activity name</span>
            <input id="wName" type="text" maxlength="100" value="${esc(d.name)}" placeholder="What did you do?" autocomplete="off" data-autofocus>
        </label>

        <div class="suggest" aria-label="Suggestions">
            ${cat(d.category).suggestions.map(s => `<button type="button" class="chip" data-action="w-suggest" data-value="${esc(s)}">${esc(s)}</button>`).join("")}
        </div>

        <div class="field">
            <span class="field__label">When?</span>
            <div class="seg" role="group" aria-label="Date">
                <button type="button" class="seg__btn ${d.date === today ? "is-on" : ""}" data-action="w-date" data-value="${today}" aria-pressed="${d.date === today}">Today</button>
                <button type="button" class="seg__btn ${d.date === yesterday ? "is-on" : ""}" data-action="w-date" data-value="${yesterday}" aria-pressed="${d.date === yesterday}">Yesterday</button>
                <button type="button" class="seg__btn ${custom ? "is-on" : ""}" data-action="w-date-custom" aria-pressed="${custom}">Pick a date</button>
            </div>
            <input id="wDate" class="${custom ? "" : "is-hidden"}" type="date" max="${today}" value="${esc(d.date)}" aria-label="Choose a date">
        </div>

        <label class="field">
            <span class="field__label">Notes <small class="muted">(optional)</small></span>
            <textarea id="wNotes" rows="2" maxlength="500" placeholder="Anything worth remembering?">${esc(d.notes)}</textarea>
        </label>`;
}

function stepTime(w) {
    const d = w.data;
    const isSleep = d.category === "sleep";
    const presets = isSleep ? [360, 420, 480, 540, 600] : [15, 25, 30, 45, 60, 90, 120];
    const stepSize = isSleep ? 15 : 5;
    return `
        <h2>${isSleep ? "How long did you sleep?" : "How long did it take?"}</h2>
        <p class="muted">Choose a preset or set an exact time.</p>

        <div class="presets" role="group" aria-label="Duration presets">
            ${presets.map(p => `<button type="button" class="chip chip--big ${d.duration === p ? "is-on" : ""}" data-action="w-preset" data-value="${p}" aria-pressed="${d.duration === p}">${fmt(p)}</button>`).join("")}
        </div>

        <div class="field">
            <span class="field__label">Exact minutes</span>
            <div class="stepperin">
                <button type="button" class="iconbtn" data-action="w-dur" data-delta="-${stepSize}" aria-label="Subtract ${stepSize} minutes">−</button>
                <input id="wDuration" type="number" min="1" max="1440" inputmode="numeric" value="${d.duration || ""}" placeholder="0" data-autofocus>
                <button type="button" class="iconbtn" data-action="w-dur" data-delta="${stepSize}" aria-label="Add ${stepSize} minutes">+</button>
                <span id="wDurText" class="muted">${d.duration ? fmt(d.duration) : ""}</span>
            </div>
        </div>

        ${isSleep ? "" : `
        <div class="field">
            <span class="field__label">How focused were you?</span>
            <div class="rating" role="group" aria-label="Focus rating">
                ${[1, 2, 3, 4, 5].map(n => `
                    <button type="button" class="rating__btn ${d.focus === n ? "is-on" : ""}" data-action="w-focus" data-value="${n}" aria-pressed="${d.focus === n}">
                        <strong>${n}</strong><small>${FOCUS_LABELS[n - 1]}</small>
                    </button>`).join("")}
            </div>
            <span class="field__hint">Optional. Ratings power your focus insights.</span>
        </div>`}`;
}

function stepReview(w) {
    const d = w.data;
    const row = (label, value, step) => `
        <div class="review__row">
            <dt>${label}</dt>
            <dd>${value}</dd>
            <button type="button" class="link" data-action="w-goto" data-step="${step}">Change</button>
        </div>`;
    return `
        <h2>${w.editingId != null ? "Review your changes" : "Looks good?"}</h2>
        <p class="muted">Check the details, then save.</p>
        <dl class="review">
            ${row("Type", `${catChip(d.category)} ${esc(cat(d.category).label)}`, 1)}
            ${row("Activity", esc(d.name), 2)}
            ${row("Date", esc(dayLabel(d.date)), 2)}
            ${row("Duration", fmt(d.duration), 3)}
            ${d.category === "sleep" ? "" : row("Focus", d.focus ? `${d.focus}/5, ${FOCUS_LABELS[d.focus - 1]}` : "Not rated", 3)}
            ${d.notes ? row("Notes", esc(d.notes), 2) : ""}
        </dl>`;
}

/* ---------- 6. Dialogs, toasts, events, startup ---------- */

function toast(message, type = "ok") {
    const t = document.createElement("div");
    t.className = `toast toast--${type}`;
    t.textContent = message;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), 4200);
}

function showBanner(text) {
    const b = $("#banner");
    b.innerHTML = `<span>${esc(text)}</span><button class="btn btn--ghost btn--small" type="button" data-action="retry">Retry</button>`;
    b.hidden = false;
}

function hideBanner() { $("#banner").hidden = true; }

function openSettings() {
    $("#setName").value = state.settings.name;
    $("#setGoal").value = state.settings.goal;
    $("#setGoalOut").textContent = fmt(state.settings.goal);
    $("#settingsDialog").showModal();
}

function route() {
    const name = (location.hash || "#dashboard").slice(1);
    state.view = VIEWS.includes(name) ? name : "dashboard";
    if (state.view === "log" && state.wizard.done) state.wizard = freshWizard();
    renderAll();
    window.scrollTo(0, 0);
}

function wizardInputChanged() {
    const next = $("#wNext");
    if (next) next.disabled = !stepValid(state.wizard.step);
}

document.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const w = state.wizard, d = w.data;
    const val = el.dataset.value;

    switch (el.dataset.action) {
        case "new-log": startWizard(); break;
        case "reco":
            startWizard({
                category: el.dataset.cat || null,
                name: el.dataset.name || "",
                duration: Number(el.dataset.dur) || 0
            });
            break;
        case "settings": openSettings(); break;
        case "close-dialog": el.closest("dialog").close(); break;
        case "retry": loadActivities(); break;
        case "export": exportCsv(); break;

        case "f-range": state.filters.range = val; renderHistory(); break;
        case "f-cat": state.filters.cat = val; renderHistory(); break;

        case "edit": {
            const a = state.activities.find(x => String(x.id) === el.dataset.id);
            if (a) startWizard({ editing: a });
            break;
        }
        case "delete": {
            const a = state.activities.find(x => String(x.id) === el.dataset.id);
            if (!a) break;
            state.pendingDeleteId = a.id;
            $("#confirmText").textContent = `"${a.name}" (${fmt(a.duration)}, ${dayLabel(a.date)}) will be removed permanently.`;
            $("#confirmDialog").showModal();
            break;
        }
        case "confirm-delete":
            $("#confirmDialog").close();
            if (state.pendingDeleteId != null) deleteActivity(state.pendingDeleteId);
            state.pendingDeleteId = null;
            break;

        // wizard
        case "w-cat":
            d.category = val;
            if (!d.duration && val === "sleep") d.duration = 480;
            w.step = 2;
            renderWizard();
            break;
        case "w-suggest": d.name = val; renderWizard(); break;
        case "w-date": d.date = val; renderWizard(); break;
        case "w-date-custom": {
            const input = $("#wDate");
            input.classList.remove("is-hidden");
            input.focus();
            if (input.showPicker) { try { input.showPicker(); } catch { /* needs a user gesture */ } }
            break;
        }
        case "w-preset": d.duration = Number(val); renderWizard(); break;
        case "w-dur": {
            d.duration = Math.min(1440, Math.max(0, (d.duration || 0) + Number(el.dataset.delta)));
            $("#wDuration").value = d.duration || "";
            $("#wDurText").textContent = d.duration ? fmt(d.duration) : "";
            $$("[data-action='w-preset']").forEach(b => {
                const on = Number(b.dataset.value) === d.duration;
                b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on);
            });
            wizardInputChanged();
            break;
        }
        case "w-focus": d.focus = d.focus === Number(val) ? null : Number(val); renderWizard(); break;
        case "w-next": if (stepValid(w.step)) { w.step++; renderWizard(); } break;
        case "w-back": if (w.step > 1) { w.step--; renderWizard(); } break;
        case "w-goto": w.step = Number(el.dataset.step); renderWizard(); break;
        case "w-save": if (!w.saving && stepValid(2) && stepValid(3)) saveActivity(); break;
    }
});

document.addEventListener("input", e => {
    const d = state.wizard.data;
    switch (e.target.id) {
        case "wName": d.name = e.target.value; wizardInputChanged(); break;
        case "wNotes": d.notes = e.target.value; break;
        case "wDate": if (e.target.value) { d.date = e.target.value; wizardInputChanged(); } break;
        case "wDuration": {
            d.duration = Math.max(0, parseInt(e.target.value, 10) || 0);
            $("#wDurText").textContent = d.duration ? fmt(d.duration) : "";
            $$("[data-action='w-preset']").forEach(b => {
                const on = Number(b.dataset.value) === d.duration;
                b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on);
            });
            wizardInputChanged();
            break;
        }
        case "searchInput": state.filters.q = e.target.value; renderHistoryList(); break;
        case "setGoal": $("#setGoalOut").textContent = fmt(Number(e.target.value)); break;
    }
});

// Enter moves to the next step from the text fields
document.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.target.id === "wName" || e.target.id === "wDuration")) {
        e.preventDefault();
        const w = state.wizard;
        if (stepValid(w.step)) { w.step++; renderWizard(); }
    }
});

$("#settingsForm").addEventListener("submit", () => {
    state.settings.name = $("#setName").value.trim();
    state.settings.goal = Number($("#setGoal").value) || 240;
    saveSettings();
    toast("Settings saved.");
    renderAll();
});

window.addEventListener("hashchange", route);

document.addEventListener("DOMContentLoaded", () => {
    state.an = analyze([]);
    route();
    loadActivities();
});
