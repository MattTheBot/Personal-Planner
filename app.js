/* ═══════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════ */
const CONFIG = {
  firebase: {
    apiKey: "AIzaSyBFj95AmxGCY01nBsQCnCD3kYhxUh6lklA",
    authDomain: "daily-planner-db712.firebaseapp.com",
    projectId: "daily-planner-db712",
    storageBucket: "daily-planner-db712.firebasestorage.app",
    messagingSenderId: "894061657165",
    appId: "1:894061657165:web:b73655157c89fce5c9f004"
  },
  defaultProvider: "openrouter"
};

const PROVIDERS = {
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "google/gemini-2.0-flash-exp:free",
    models: [
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "deepseek/deepseek-r1:free"
    ]
  },
  zai: {
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4/chat/completions",
    defaultModel: "glm-4.7-flash",
    models: ["glm-4.7-flash", "glm-4.5-flash"]
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
  }
};

const DEFAULT_SUBJECT_COLORS = [
  "#5C9EAD","#8CB369","#F2C94C","#CC6B6B",
  "#9B7FBE","#E8985E","#5FA8A0","#C77899"
];

/* ═══════════════════════════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fbApp = initializeApp(CONFIG.firebase);
const auth  = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const escapeHTML = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const shiftISO = (iso, days) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const prettyDate = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long", year:"numeric" }) : "";
const shortDate = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day:"numeric", month:"short" }) : "No date";
const dowShort = iso => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday:"short" });
const dayNum = iso => new Date(iso + "T00:00:00").getDate();

// Returns Monday of week containing given ISO date
const mondayOf = iso => {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  return shiftISO(iso, -dow);
};

const state = {
  user: null,
  profile: {},
  subjects: [],
  assignments: [],
  timebox: [],
  notes: [],
  view: "home",
  parsed: [],
  weekStart: mondayOf(todayISO()),
  tbZoom: 1, // 1 = 30min rows, 2 = 60min rows
  unsubs: []
};

/* ── academic calendar ────────────────────────────────────────── */
const DEFAULT_SCHOOL_WEEKDAYS = [1,2,3,4,5];

function academicNow() {
  const today = todayISO();
  const p = state.profile;
  const out = { today, week: null, day: null, breakName: null };

  for (const b of (p.breaks || [])) {
    if (b.start && b.end && today >= b.start && today <= b.end) {
      out.breakName = b.name || "Break"; break;
    }
  }
  if (!p.termStart || today < p.termStart) return out;

  const perWeek = Math.max(1, Number(p.schoolDays) || 5);
  const breaks = p.breaks || [];
  let n = 0, d = p.termStart;
  while (d <= today) {
    const dow = new Date(d + "T00:00:00").getDay();
    const inBreak = breaks.some(b => b.start && b.end && d >= b.start && d <= b.end);
    if (DEFAULT_SCHOOL_WEEKDAYS.includes(dow) && !inBreak) n++;
    if (d === today) break;
    d = shiftISO(d, 1);
  }
  if (n === 0) return out;
  out.week = Math.ceil(n / perWeek);
  out.day  = ((n - 1) % perWeek) + 1;
  return out;
}

function bucketOf(a) {
  if (a.status === "done") return "done";
  const today = todayISO();
  if (!a.due) return "new";
  if (a.due < today) return "old";
  return daysBetween(today, a.due) <= 2 ? "urgent" : "upcoming";
}

function subjectById(id) { return state.subjects.find(s => s.id === id); }
function subjectColor(id, fallback) { return subjectById(id)?.color || fallback || "#5C9EAD"; }
function subjectName(id) { return subjectById(id)?.name || ""; }

/* ── toast / sheet ────────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
function openSheet(html) {
  $("#sheetContent").innerHTML = html;
  $("#sheetBg").classList.add("open");
  $("#sheet").classList.add("open");
}
function closeSheet() {
  $("#sheetBg").classList.remove("open");
  $("#sheet").classList.remove("open");
}
$("#sheetBg").onclick = closeSheet;
window.closeSheet = closeSheet;

/* ═══════════════════ AUTH ═══════════════════ */
const authError = (m) => {
  const e = $("#authError");
  if (!m) { e.hidden = true; return; }
  e.textContent = m; e.hidden = false;
};

$("#btnSignIn").onclick = async () => {
  authError("");
  const email = $("#authEmail").value.trim();
  const pass  = $("#authPassword").value;
  if (!email || !pass) return authError("Enter an email and password.");
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { authError(e.message.replace("Firebase: ", "")); }
};
$("#btnSignUp").onclick = async () => {
  authError("");
  const email = $("#authEmail").value.trim();
  const pass  = $("#authPassword").value;
  if (!email || pass.length < 6) return authError("Password must be at least 6 characters.");
  try { await createUserWithEmailAndPassword(auth, email, pass); }
  catch (e) { authError(e.message.replace("Firebase: ", "")); }
};
$("#btnGoogle").onclick = async () => {
  authError("");
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (["auth/popup-blocked","auth/popup-closed-by-user","auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      try { await signInWithRedirect(auth, provider); }
      catch (e2) { authError(e2.message.replace("Firebase: ", "")); }
    } else authError(e.message.replace("Firebase: ", ""));
  }
};
getRedirectResult(auth).catch(() => {});
$("#btnSignOut").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  state.unsubs.forEach(u => u());
  state.unsubs = [];

  if (!user) {
    state.user = null;
    $("#app").hidden = true;
    $("#authScreen").style.display = "";
    return;
  }

  state.user = user;
  $("#authScreen").style.display = "none";
  $("#app").hidden = false;
  $("#accountEmail").textContent = user.email || "";

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      termStart: "", schoolDays: 5, navPosition: "left",
      provider: CONFIG.defaultProvider, apiKey: "",
      model: PROVIDERS[CONFIG.defaultProvider].defaultModel,
      breaks: [], tbZoom: 1,
      createdAt: serverTimestamp()
    });
  }

  state.unsubs.push(onSnapshot(ref, (s) => {
    state.profile = s.data() || {};
    state.tbZoom = state.profile.tbZoom || 1;
    applyNavPosition();
    renderHome();
    renderSettings();
    renderTimebox();
  }));

  state.unsubs.push(onSnapshot(collection(db, "users", user.uid, "subjects"), (s) => {
    state.subjects = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderHome();
    renderAssignments();
    renderTimebox();
    renderSettings();
    renderSubjectSelect();
  }));

  state.unsubs.push(onSnapshot(collection(db, "users", user.uid, "assignments"), (s) => {
    state.assignments = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    renderAssignments();
    renderTimebox();
  }));

  state.unsubs.push(onSnapshot(collection(db, "users", user.uid, "timebox"), (s) => {
    state.timebox = s.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    renderTimebox();
  }));

  state.unsubs.push(onSnapshot(collection(db, "users", user.uid, "notes"), (s) => {
    state.notes = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderHome();
    renderNotes();
  }));
});

/* ═══════════════════ NAV ═══════════════════ */
function applyNavPosition() {
  document.body.className = (state.profile.navPosition === "left") ? "nav-left" : "nav-top";
}
function switchView(v) {
  state.view = v;
  $$(".view").forEach(el => el.classList.toggle("active", el.id === "view-" + v));
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-btn").forEach(b => b.onclick = () => {
  switchView(b.dataset.view);
  if (b.dataset.view === "home") renderHome();
  if (b.dataset.view === "assignments") renderAssignments();
  if (b.dataset.view === "timebox") renderTimebox();
  if (b.dataset.view === "notes") renderNotes();
  if (b.dataset.view === "settings") renderSettings();
});

/* ═══════════════════ RENDER: HOME ═══════════════════ */
function renderHome() {
  const info = academicNow();
  let line = "Today is " + prettyDate(info.today);
  if (info.week) line += ` · Week ${info.week}, Day ${info.day}`;
  $("#homeDate").textContent = line;

  const bb = $("#homeBreak");
  if (info.breakName) { bb.hidden = false; bb.textContent = "On break: " + info.breakName; }
  else {
    const upcoming = (state.profile.breaks || [])
      .filter(b => b.start && b.start > info.today)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (upcoming) { bb.hidden = false; bb.textContent = `${upcoming.name || "Break"} in ${daysBetween(info.today, upcoming.start)} days`; }
    else bb.hidden = true;
  }

  const active = state.assignments.filter(a => a.status !== "done");
  const overdue = active.filter(a => bucketOf(a) === "old").length;
  const doneAll = state.assignments.filter(a => a.status === "done");
  const totalAll = state.assignments.length;
  const completionPct = totalAll ? Math.round(doneAll.length / totalAll * 100) : 0;

  // Stats header
  $("#homeStats").innerHTML = `
    <div class="stat"><div class="v">${active.length}</div><div class="l">Active</div></div>
    <div class="stat"><div class="v">${overdue}</div><div class="l">Overdue</div></div>
    <div class="stat"><div class="v">${completionPct}%</div><div class="l">Complete</div></div>
  `;

  // Today panel
  const today = info.today;
  const todayTasks = active.filter(a => a.due === today);
  const todayBoxEntries = state.timebox.filter(t => t.date === today);
  const todayBoxMins = todayBoxEntries.reduce((a, t) => a + (Number(t.duration) || 30), 0);
  const todayDone = doneAll.filter(a => a.completedAt && a.completedAt.toDate?.().toISOString?.().slice(0,10) === today).length;

  $("#homeToday").innerHTML = `
    <div class="dash-big">${todayTasks.length + todayBoxEntries.length}</div>
    <div class="dash-mini">items scheduled today</div>
    <div class="dash-row" style="margin-top:14px"><span class="lbl">Due today</span><span class="val">${todayTasks.length}</span></div>
    <div class="dash-row"><span class="lbl">Scheduled blocks</span><span class="val">${todayBoxEntries.length}</span></div>
    <div class="dash-row"><span class="lbl">Time blocked</span><span class="val">${Math.floor(todayBoxMins/60)}h ${todayBoxMins%60}m</span></div>
    <div class="dash-row"><span class="lbl">Completed today</span><span class="val">${todayDone}</span></div>
  `;

  // Week panel
  const weekEnd = shiftISO(mondayOf(today), 6);
  const weekTasks = active.filter(a => a.due && a.due >= mondayOf(today) && a.due <= weekEnd);
  const weekOverdue = active.filter(a => a.due && a.due < mondayOf(today)).length;
  const weekBoxEntries = state.timebox.filter(t => t.date >= mondayOf(today) && t.date <= weekEnd);
  const weekBoxMins = weekBoxEntries.reduce((a, t) => a + (Number(t.duration) || 30), 0);
  const weekDone = doneAll.filter(a => {
    const d = a.completedAt?.toDate?.();
    if (!d) return false;
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return iso >= mondayOf(today) && iso <= weekEnd;
  }).length;

  $("#homeWeek").innerHTML = `
    <div class="dash-big">${weekTasks.length + weekDone}</div>
    <div class="dash-mini">tasks with a due date this week</div>
    <div class="dash-row" style="margin-top:14px"><span class="lbl">Due this week</span><span class="val">${weekTasks.length}</span></div>
    <div class="dash-row"><span class="lbl">Completed</span><span class="val">${weekDone}</span></div>
    <div class="dash-row"><span class="lbl">Carried over</span><span class="val">${weekOverdue}</span></div>
    <div class="dash-row"><span class="lbl">Time blocked</span><span class="val">${Math.floor(weekBoxMins/60)}h ${weekBoxMins%60}m</span></div>
  `;

  // Quick notes
  const topNotes = state.notes.slice(0, 3);
  $("#homeNotes").innerHTML = topNotes.length
    ? topNotes.map(n => `
        <div class="dash-row" style="cursor:pointer" data-note-id="${n.id}">
          <span class="lbl" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(n.title || n.body || "(untitled)")}</span>
          <span class="val" style="color:var(--text-dim);font-size:11px;font-weight:500">${n.date ? shortDate(n.date) : ""}</span>
        </div>`).join("")
    : `<div class="bucket-empty in-card">No notes yet.</div>`;
  $$("#homeNotes [data-note-id]").forEach(el => el.onclick = () => {
    switchView("notes");
    setTimeout(() => openNote(el.dataset.noteId), 100);
  });

  // Buckets
  const buckets = { new: [], upcoming: [], urgent: [], old: [] };
  active.forEach(a => buckets[bucketOf(a)].push(a));
  Object.values(buckets).forEach(list =>
    list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))
  );
  for (const key of Object.keys(buckets)) {
    $("#count-" + key).textContent = buckets[key].length;
    $("#bucket-" + key).innerHTML = buckets[key].length
      ? buckets[key].map(taskRowHTML).join("")
      : `<div class="bucket-empty">Nothing here.</div>`;
  }
  $$("#view-home .task input[type=checkbox]").forEach(cb => {
    cb.onchange = () => toggleDone(cb.dataset.id, cb.checked);
  });
}

function taskRowHTML(a) {
  const b = bucketOf(a);
  const today = todayISO();
  let dueCls = "", dueTxt = "No due date";
  if (a.due) {
    dueTxt = shortDate(a.due);
    if (a.due < today) { dueCls = "overdue"; dueTxt = "Overdue · " + dueTxt; }
    else if (b === "urgent") dueCls = "due-soon";
  }
  const s = subjectById(a.subjectId);
  const dot = s ? `<span class="subject-dot" style="background:${s.color}"></span>` : "";
  const subjLabel = s ? `<span class="chip">${dot}${escapeHTML(s.name)}</span>` : (a.subject ? `<span class="chip">${escapeHTML(a.subject)}</span>` : "");
  return `
    <div class="task" data-id="${a.id}">
      <input type="checkbox" data-id="${a.id}" ${a.status === "done" ? "checked" : ""}>
      <div class="task-body">
        <div class="task-title">${escapeHTML(a.title)}</div>
        <div class="task-meta">
          ${subjLabel}
          <span class="chip ${dueCls}">${escapeHTML(dueTxt)}</span>
          ${a.estimatedMinutes ? `<span>${a.estimatedMinutes} min</span>` : ""}
        </div>
      </div>
    </div>`;
}

async function toggleDone(id, done) {
  const payload = done
    ? { status: "done", completedAt: serverTimestamp() }
    : { status: "active", completedAt: null };
  await updateDoc(doc(db, "users", state.user.uid, "assignments", id), payload);
}

/* ═══════════════════ RENDER: ASSIGNMENTS ═══════════════════ */
function renderAssignments() {
  const active = state.assignments.filter(a => a.status !== "done")
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const done = state.assignments.filter(a => a.status === "done")
    .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

  $("#assignActive").innerHTML = active.length
    ? active.map(assignRowHTML).join("")
    : `<div class="bucket-empty in-card">No active assignments.</div>`;
  $("#assignDone").innerHTML = done.length
    ? done.map(assignRowHTML).join("")
    : `<div class="bucket-empty in-card">Nothing completed yet.</div>`;

  $$("#view-assignments .task input[type=checkbox]").forEach(cb => {
    cb.onchange = () => toggleDone(cb.dataset.id, cb.checked);
  });
  $$("#view-assignments .js-sched").forEach(btn => {
    btn.onclick = () => toggleScheduleForm(btn.closest(".task"), btn.dataset.id);
  });
  $$("#view-assignments .js-del").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete this assignment?")) return;
      await deleteDoc(doc(db, "users", state.user.uid, "assignments", btn.dataset.id));
    };
  });
}

function assignRowHTML(a) {
  const b = bucketOf(a);
  const today = todayISO();
  let dueTxt = a.due ? shortDate(a.due) : "No due date";
  let dueCls = "";
  if (a.due && a.due < today) { dueCls = "overdue"; dueTxt = "Overdue · " + dueTxt; }
  else if (b === "urgent") dueCls = "due-soon";

  const s = subjectById(a.subjectId);
  const dot = s ? `<span class="subject-dot" style="background:${s.color}"></span>` : "";
  const subjLabel = s ? `<span class="chip">${dot}${escapeHTML(s.name)}</span>` : (a.subject ? `<span class="chip">${escapeHTML(a.subject)}</span>` : "");

  return `
    <div class="task ${a.status === "done" ? "done" : ""}" data-id="${a.id}">
      <input type="checkbox" data-id="${a.id}" ${a.status === "done" ? "checked" : ""}>
      <div class="task-body">
        <div class="task-title">${escapeHTML(a.title)}</div>
        <div class="task-meta">
          ${subjLabel}
          <span class="chip ${dueCls}">${escapeHTML(dueTxt)}</span>
          ${a.estimatedMinutes ? `<span>${a.estimatedMinutes} min</span>` : ""}
        </div>
      </div>
      <button class="icon-btn js-sched" data-id="${a.id}" title="Schedule">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
      </button>
      <button class="icon-btn js-del" data-id="${a.id}" title="Delete">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`;
}

function toggleScheduleForm(row, id) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("sched-form")) { existing.remove(); return; }

  const a = state.assignments.find(x => x.id === id);
  const defDate = a?.due && a.due >= todayISO() ? a.due : todayISO();
  const html = `
    <div class="sched-form">
      <label class="small muted">Date</label>
      <input type="date" class="sf-date" value="${defDate}">
      <label class="small muted">Time</label>
      <select class="sf-hour">
        ${Array.from({length: 36}, (_, i) => {
          const h = 6 + Math.floor(i/2);
          const m = (i%2)*30;
          const val = `${h}:${m === 0 ? "00" : "30"}`;
          return `<option value="${val}">${val}</option>`;
        }).join("")}
      </select>
      <button class="btn primary sf-save">Add to timeline</button>
    </div>`;
  row.insertAdjacentHTML("afterend", html);
  const form = row.nextElementSibling;
  form.querySelector(".sf-save").onclick = async () => {
    const date = form.querySelector(".sf-date").value;
    const time = form.querySelector(".sf-hour").value;
    if (!date) return toast("Pick a date");
    const [h, m] = time.split(":").map(Number);
    await addDoc(collection(db, "users", state.user.uid, "timebox"), {
      date, hour: h, minute: m, duration: 30,
      title: a.title, subjectId: a.subjectId || "",
      assignmentId: a.id, type: "assignment",
      createdAt: serverTimestamp()
    });
    form.remove();
    toast("Added to timeline");
  };
}

/* manual add */
$("#btnToggleAdd").onclick = () => { $("#manualForm").hidden = !$("#manualForm").hidden; };
$("#btnCancelAdd").onclick  = () => { $("#manualForm").hidden = true; };

function renderSubjectSelect() {
  const sel = $("#mSubjectId");
  if (!sel) return;
  sel.innerHTML = `<option value="">— No subject —</option>` +
    state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join("");
}

$("#btnSaveManual").onclick = async () => {
  const title = $("#mTitle").value.trim();
  if (!title) return toast("Title is required");
  await addDoc(collection(db, "users", state.user.uid, "assignments"), {
    title,
    subjectId: $("#mSubjectId").value || "",
    subject: "",
    due: $("#mDue").value || "",
    estimatedMinutes: Number($("#mMins").value) || 0,
    notes: $("#mNotes").value.trim(),
    status: "active", source: "manual",
    createdAt: serverTimestamp()
  });
  $("#mTitle").value = $("#mSubjectId").value = $("#mDue").value = $("#mMins").value = $("#mNotes").value = "";
  $("#manualForm").hidden = true;
  toast("Assignment added");
};

/* ═══════════════════ RENDER: TIMEBOX (week view) ═══════════════════ */
function timeboxRowHeight() { return state.tbZoom === 1 ? 32 : 48; }

function renderTimebox() {
  const weekStart = state.weekStart;
  const weekEnd = shiftISO(weekStart, 6);
  $("#tbSubtitle").textContent = `${shortDate(weekStart)} – ${shortDate(weekEnd)}`;
  $("#tbZoomLabel").textContent = state.tbZoom === 1 ? "30 min" : "60 min";

  const today = todayISO();
  const rowsPerHour = state.tbZoom === 1 ? 2 : 1;
  const startHour = 6, endHour = 23;
  const totalRows = (endHour - startHour) * rowsPerHour;

  let html = "";
  // Header row: corner + 7 day headers
  html += `<div class="tb-week-corner"></div>`;
  for (let i = 0; i < 7; i++) {
    const iso = shiftISO(weekStart, i);
    const isToday = iso === today;
    html += `<div class="tb-week-head ${isToday ? "today" : ""}">
      <span class="dow">${dowShort(iso)}</span>
      <span class="dom">${dayNum(iso)}</span>
    </div>`;
  }

  // Rows
  for (let r = 0; r < totalRows; r++) {
    const hour = startHour + Math.floor(r / rowsPerHour);
    const minute = (r % rowsPerHour) * (60 / rowsPerHour);
    const timeLabel = state.tbZoom === 1
      ? (minute === 0 ? `${String(hour).padStart(2,"0")}:00` : "")
      : `${String(hour).padStart(2,"0")}:00`;

    html += `<div class="tb-hour ${state.tbZoom === 2 ? "tall" : ""}">${timeLabel}</div>`;

    for (let i = 0; i < 7; i++) {
      const iso = shiftISO(weekStart, i);
      const isToday = iso === today;
      const entries = state.timebox.filter(t =>
        t.date === iso &&
        Number(t.hour) === hour &&
        (state.tbZoom === 2 ? true : (Number(t.minute) || 0) === minute)
      );

      const cellContent = entries.map(e => {
        const color = e.type === "custom"
          ? (e.color || "#6b7280")
          : subjectColor(e.subjectId, "#5C9EAD");
        const title = e.title || subjectName(e.subjectId) || "Untitled";
        return `<div class="tb-entry ${e.type || 'assignment'}"
                     style="background:${color}"
                     data-tid="${e.id}"
                     title="${escapeHTML(title)}">
                  <span class="entry-title">${escapeHTML(title)}</span>
                  <span class="entry-x" data-del="${e.id}">×</span>
                </div>`;
      }).join("");

      html += `<div class="tb-cell ${isToday ? "today" : ""} ${state.tbZoom === 2 ? "tall" : ""}"
                    data-date="${iso}"
                    data-hour="${hour}"
                    data-minute="${minute}">${cellContent}</div>`;
    }
  }

  $("#tbWeek").innerHTML = html;

  // Interactions
  $$("#tbWeek .tb-cell").forEach(cell => {
    cell.onclick = (e) => {
      if (e.target.closest(".tb-entry")) return;
      openQuickAdd(cell);
    };
  });
  $$("#tbWeek .entry-x").forEach(x => {
    x.onclick = async (e) => {
      e.stopPropagation();
      await deleteDoc(doc(db, "users", state.user.uid, "timebox", x.dataset.del));
    };
  });
  $$("#tbWeek .tb-entry").forEach(entry => {
    entry.onclick = (e) => {
      if (e.target.closest(".entry-x")) return;
      const tid = entry.dataset.tid;
      const item = state.timebox.find(t => t.id === tid);
      if (item) openEntryDetail(item);
    };
  });
}

function openEntryDetail(item) {
  const isCustom = item.type === "custom";
  const color = isCustom ? (item.color || "#6b7280") : subjectColor(item.subjectId, "#5C9EAD");
  const s = subjectById(item.subjectId);
  openSheet(`
    <h3>${escapeHTML(item.title || "Untitled")}</h3>
    <p class="muted small" style="margin-bottom:16px">
      ${shortDate(item.date)} · ${String(item.hour).padStart(2,"0")}:${String(item.minute || 0).padStart(2,"0")} · ${item.duration || 30} min
    </p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
      <span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${color}"></span>
      <span class="muted small">${isCustom ? "Custom slot" : (s ? "Subject: " + escapeHTML(s.name) : "Assignment block")}</span>
    </div>
    <div class="row end">
      <button class="btn" onclick="closeSheet()">Close</button>
      <button class="btn danger" id="delEntry">Delete</button>
    </div>
  `);
  $("#delEntry").onclick = async () => {
    await deleteDoc(doc(db, "users", state.user.uid, "timebox", item.id));
    closeSheet();
    toast("Removed");
  };
}

function openQuickAdd(cell) {
  if (cell.querySelector(".tb-add")) return;
  const date = cell.dataset.date;
  const hour = Number(cell.dataset.hour);
  const minute = Number(cell.dataset.minute);
  cell.innerHTML = `<input class="tb-add-input" type="text" placeholder="Title…" autofocus>`;
  const input = cell.querySelector(".tb-add-input");
  input.style.cssText = "width:100%;padding:2px 4px;border:1px solid var(--accent);border-radius:4px;font-size:11px;height:100%;";
  input.focus();

  const commit = async () => {
    const title = input.value.trim();
    if (!title) { renderTimebox(); return; }
    const color = pickCustomColor();
    await addDoc(collection(db, "users", state.user.uid, "timebox"), {
      date, hour, minute, duration: 30,
      title, type: "custom",
      color,
      assignmentId: null, subjectId: "",
      createdAt: serverTimestamp()
    });
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") renderTimebox();
  };
  input.onblur = () => setTimeout(() => { if (input.value.trim()) commit(); else renderTimebox(); }, 140);
}

function pickCustomColor() {
  // deterministic palette based on time-of-day + counter to avoid same-colour chaos
  const palette = ["#8CB369","#5C9EAD","#9B7FBE","#E8985E","#CC6B6B","#5FA8A0","#C77899","#F2C94C"];
  return palette[Math.floor(Math.random() * palette.length)];
}

/* Week nav + zoom */
$("#tbPrevWeek").onclick = () => { state.weekStart = shiftISO(state.weekStart, -7); renderTimebox(); };
$("#tbNextWeek").onclick = () => { state.weekStart = shiftISO(state.weekStart, 7); renderTimebox(); };
$("#tbThisWeek").onclick = () => { state.weekStart = mondayOf(todayISO()); renderTimebox(); };
$("#tbZoomIn").onclick = async () => {
  state.tbZoom = Math.max(1, state.tbZoom - 1);
  await setDoc(doc(db, "users", state.user.uid), { tbZoom: state.tbZoom }, { merge: true });
  renderTimebox();
};
$("#tbZoomOut").onclick = async () => {
  state.tbZoom = Math.min(2, state.tbZoom + 1);
  await setDoc(doc(db, "users", state.user.uid), { tbZoom: state.tbZoom }, { merge: true });
  renderTimebox();
};
$("#tbAddCustom").onclick = () => openCustomSlotSheet();

function openCustomSlotSheet(presetDate) {
  const dateVal = presetDate || todayISO();
  const times = [];
  for (let h = 6; h < 23; h++) {
    times.push(`${String(h).padStart(2,"0")}:00`);
    times.push(`${String(h).padStart(2,"0")}:30`);
  }
  openSheet(`
    <h3>Custom slot</h3>
    <p class="muted small" style="margin-bottom:14px">Anything that isn't an assignment — a class, a workout, a break, a commitment.</p>
    <label class="field">Title
      <input type="text" id="csTitle" placeholder="e.g. Football practice" />
    </label>
    <div class="grid-2">
      <label class="field">Date
        <input type="date" id="csDate" value="${dateVal}" />
      </label>
      <label class="field">Start time
        <select id="csTime">
          ${times.map(t => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="grid-2">
      <label class="field">Duration (min)
        <select id="csDur">
          <option value="30">30</option>
          <option value="60" selected>60</option>
          <option value="90">90</option>
          <option value="120">120</option>
        </select>
      </label>
      <label class="field">Colour
        <input type="color" id="csColor" value="${pickCustomColor()}" style="height:40px;padding:4px" />
      </label>
    </div>
    <div class="row end">
      <button class="btn" onclick="closeSheet()">Cancel</button>
      <button class="btn primary" id="csSave">Add slot</button>
    </div>
  `);
  $("#csSave").onclick = async () => {
    const title = $("#csTitle").value.trim();
    if (!title) return toast("Title required");
    const date = $("#csDate").value;
    const [h, m] = $("#csTime").value.split(":").map(Number);
    const duration = Number($("#csDur").value) || 60;
    const color = $("#csColor").value;

    // Split into 30-minute blocks so the grid renders it
    const blocks = Math.max(1, Math.ceil(duration / 30));
    let curH = h, curM = m;
    for (let i = 0; i < blocks; i++) {
      await addDoc(collection(db, "users", state.user.uid, "timebox"), {
        date, hour: curH, minute: curM, duration: 30,
        title, type: "custom", color,
        group: `${title}-${date}-${h}:${m}`,
        assignmentId: null, subjectId: "",
        createdAt: serverTimestamp()
      });
      curM += 30;
      if (curM >= 60) { curM -= 60; curH += 1; }
    }
    closeSheet();
    toast("Slot added");
  };
}

/* ═══════════════════ RENDER: NOTES ═══════════════════ */
function renderNotes() {
  const grid = $("#notesGrid");
  grid.innerHTML = state.notes.length ? state.notes.map(n => `
    <div class="note-card" data-id="${n.id}">
      <div class="note-title">${escapeHTML(n.title || "Untitled")}</div>
      <div class="note-body">${escapeHTML(n.body || "")}</div>
      <div class="note-date">${n.date ? shortDate(n.date) : ""}</div>
    </div>`).join("")
    : `<div class="card" style="grid-column:1/-1"><div class="bucket-empty in-card">No notes yet. Click + New note to start.</div></div>`;
  $$("#notesGrid .note-card").forEach(c => c.onclick = () => openNote(c.dataset.id));
}

$("#btnNewNote").onclick = () => openNote(null);

function openNote(id) {
  const n = id ? state.notes.find(x => x.id === id) : null;
  openSheet(`
    <h3>${n ? "Edit note" : "New note"}</h3>
    <label class="field">Title
      <input type="text" id="noteTitle" value="${n ? escapeHTML(n.title || "") : ""}" placeholder="Optional" />
    </label>
    <label class="field">Body
      <textarea id="noteBody" rows="8" placeholder="Write anything…">${n ? escapeHTML(n.body || "") : ""}</textarea>
    </label>
    <label class="field">Date
      <input type="date" id="noteDate" value="${n?.date || todayISO()}" />
    </label>
    <div class="row end">
      ${n ? `<button class="btn danger" id="noteDel">Delete</button>` : ""}
      <button class="btn" onclick="closeSheet()">Cancel</button>
      <button class="btn primary" id="noteSave">Save</button>
    </div>
  `);
  $("#noteSave").onclick = async () => {
    const title = $("#noteTitle").value.trim();
    const body = $("#noteBody").value.trim();
    const date = $("#noteDate").value;
    if (!title && !body) return toast("Note is empty");
    if (n) {
      await updateDoc(doc(db, "users", state.user.uid, "notes", n.id), { title, body, date });
    } else {
      await addDoc(collection(db, "users", state.user.uid, "notes"), {
        title, body, date, createdAt: serverTimestamp()
      });
    }
    closeSheet();
    toast("Saved");
  };
  if (n) $("#noteDel").onclick = async () => {
    if (!confirm("Delete this note?")) return;
    await deleteDoc(doc(db, "users", state.user.uid, "notes", n.id));
    closeSheet();
    toast("Deleted");
  };
}

/* ═══════════════════ RENDER: SETTINGS ═══════════════════ */
function populateModels(providerKey, selected) {
  const prov = PROVIDERS[providerKey] || PROVIDERS[CONFIG.defaultProvider];
  const sel = $("#setModel");
  sel.innerHTML = prov.models.map(m => `<option value="${m}">${m}</option>`).join("");
  sel.value = (selected && prov.models.includes(selected)) ? selected : prov.defaultModel;
}

function renderSettings() {
  const p = state.profile;
  $("#setProvider").value  = p.provider || CONFIG.defaultProvider;
  $("#setApiKey").value    = p.apiKey || "";
  populateModels(p.provider || CONFIG.defaultProvider, p.model);
  $("#setTermStart").value = p.termStart || "";
  $("#setSchoolDays").value = p.schoolDays || 5;
  $("#setNavPos").value    = p.navPosition || "left";
  renderBreaks();
  renderSubjects();
}

$("#setProvider").onchange = () => populateModels($("#setProvider").value, null);

function renderBreaks() {
  const list = state.profile.breaks || [];
  $("#breakList").innerHTML = list.map((b, i) => `
    <div class="break-row" data-i="${i}" style="display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:10px;align-items:center;margin-bottom:10px">
      <input class="bk-name" type="text" placeholder="Christmas break" value="${escapeHTML(b.name || "")}" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13.5px">
      <input class="bk-start" type="date" value="${b.start || ""}" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13.5px">
      <input class="bk-end" type="date" value="${b.end || ""}" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:13.5px">
      <button class="icon-btn bk-del" data-i="${i}">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`).join("") || `<p class="muted small" style="margin-bottom:12px">No breaks configured.</p>`;

  $$("#breakList .bk-del").forEach(b => b.onclick = () => {
    const next = [...(state.profile.breaks || [])];
    next.splice(Number(b.dataset.i), 1);
    state.profile.breaks = next;
    renderBreaks();
  });
  $$("#breakList .break-row input").forEach(inp => inp.oninput = () => {
    const row = inp.closest(".break-row");
    const i = Number(row.dataset.i);
    const next = [...(state.profile.breaks || [])];
    if (!next[i]) return;
    next[i] = {
      name: row.querySelector(".bk-name").value,
      start: row.querySelector(".bk-start").value,
      end: row.querySelector(".bk-end").value
    };
    state.profile.breaks = next;
  });
}

$("#btnAddBreak").onclick = () => {
  state.profile.breaks = [...(state.profile.breaks || []), { name: "", start: "", end: "" }];
  renderBreaks();
};

function renderSubjects() {
  const list = state.subjects;
  $("#subjectList").innerHTML = list.map((s, i) => `
    <div class="subject-row" data-id="${s.id}">
      <input type="text" class="subj-name" value="${escapeHTML(s.name)}" placeholder="e.g. Maths">
      <input type="color" class="subj-color" value="${s.color || '#5C9EAD'}">
      <button class="icon-btn subj-del" data-id="${s.id}">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`).join("") || `<p class="muted small" style="margin-bottom:12px">No subjects yet.</p>`;

  $$("#subjectList .subj-name").forEach(inp => inp.oninput = async () => {
    const id = inp.closest(".subject-row").dataset.id;
    await updateDoc(doc(db, "users", state.user.uid, "subjects", id), { name: inp.value.trim() });
  });
  $$("#subjectList .subj-color").forEach(inp => inp.oninput = async () => {
    const id = inp.closest(".subject-row").dataset.id;
    await updateDoc(doc(db, "users", state.user.uid, "subjects", id), { color: inp.value });
  });
  $$("#subjectList .subj-del").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this subject?")) return;
    await deleteDoc(doc(db, "users", state.user.uid, "subjects", b.dataset.id));
  });
}

$("#btnAddSubject").onclick = async () => {
  const color = DEFAULT_SUBJECT_COLORS[state.subjects.length % DEFAULT_SUBJECT_COLORS.length];
  await addDoc(collection(db, "users", state.user.uid, "subjects"), {
    name: "New subject",
    color,
    createdAt: serverTimestamp()
  });
};

$("#btnSaveSettings").onclick = async () => {
  await setDoc(doc(db, "users", state.user.uid), {
    provider: $("#setProvider").value,
    apiKey: $("#setApiKey").value.trim(),
    model: $("#setModel").value,
    termStart: $("#setTermStart").value || "",
    schoolDays: Number($("#setSchoolDays").value) || 5,
    navPosition: $("#setNavPos").value,
    breaks: (state.profile.breaks || []).filter(b => b.name || b.start || b.end)
  }, { merge: true });
  toast("Settings saved");
  renderHome();
};

/* ═══════════════════ AI ═══════════════════ */
$("#btnTestKey").onclick = async () => {
  const st = $("#keyStatus");
  st.textContent = "Testing…"; st.className = "status";

  const providerKey = $("#setProvider").value;
  const apiKey = $("#setApiKey").value.trim();
  const model  = $("#setModel").value;
  const prov   = PROVIDERS[providerKey] || PROVIDERS[CONFIG.defaultProvider];

  if (!apiKey) { st.textContent = "No API key entered."; st.className = "status err"; return; }
  if (!navigator.onLine) { st.textContent = "Offline."; st.className = "status err"; return; }

  try {
    const res = await fetch(prov.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": location.origin,
        "X-Title": "Portal Planner"
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }] })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} — ${txt.slice(0, 180)}`);
    }
    st.textContent = "Connection works."; st.className = "status ok";
  } catch (e) {
    st.textContent = e.message || "Request failed"; st.className = "status err";
  }
};

async function callAIStream(prompt, { systemText = "", onChunk = null } = {}) {
  const p = state.profile;
  const providerKey = p.provider || CONFIG.defaultProvider;
  const prov = PROVIDERS[providerKey] || PROVIDERS[CONFIG.defaultProvider];
  const apiKey = (p.apiKey || "").trim();
  const model  = p.model || prov.defaultModel;

  if (!apiKey) throw new Error("No API key set — open Settings.");
  if (!navigator.onLine) throw new Error("AI temporarily unavailable offline.");

  const messages = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  messages.push({ role: "user", content: prompt });

  const body = {
    model, messages,
    temperature: 0.15,
    response_format: { type: "json_object" },
    stream: true
  };

  const res = await fetch(prov.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin,
      "X-Title": "Portal Planner"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          acc += delta;
          if (onChunk) onChunk(acc, delta);
        }
      } catch { /* partial json in stream; safe to skip */ }
    }
  }

  if (!acc) throw new Error("Empty AI response.");
  const cleaned = acc.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned);
}

function buildSystemPrompt() {
  const info = academicNow();
  const p = state.profile;
  const breaks = (p.breaks || []).filter(b => b.start);
  const breakLines = breaks.length
    ? breaks.map(b => `  • ${b.name || "Break"}: ${b.start} → ${b.end}`).join("\n")
    : "  (none configured)";
  const dow = new Date().toLocaleDateString(undefined, { weekday: "long" });
  const perWeek = Math.max(1, Number(p.schoolDays) || 5);
  const termStart = p.termStart || "(not set)";

  const subjLines = state.subjects.length
    ? state.subjects.map(s => `  • ${s.name} (id: ${s.id})`).join("\n")
    : "  (none configured — leave subjectId empty)";

  return `You are an assignment parser for a school planner. You always return valid JSON.

CURRENT CONTEXT:
  Today's date: ${info.today} (${dow})
  Local time: ${new Date().toLocaleTimeString()}
  Academic position: ${info.week ? `Week ${info.week}, Day ${info.day}` : "outside term"}
  Term started: ${termStart} — this is Week 1 Day 1
  School week: ${perWeek} days/week (Mon–Fri). Weekends skipped.
${info.breakName ? `  CURRENTLY ON BREAK: ${info.breakName}` : ""}

KNOWN BREAKS (school days inside these ranges do NOT advance the week/day tally):
${breakLines}

AVAILABLE SUBJECTS (always use one of these IDs when the text references a class; match by name, abbreviation, or context):
${subjLines}

HOW TO RESOLVE "WEEK N DAY M":
  Walk forward from ${termStart}, counting only Mon–Fri (skipping weekends and break dates).
  The 1st school day is Week 1 Day 1. The ${perWeek + 1}th school day is Week 2 Day 1.
  Output the resolved YYYY-MM-DD.

RULES:
1. Extract every distinct assignment or task.
2. Resolve all relative dates. Output YYYY-MM-DD. NEVER invent a date — empty string if unknown.
3. If the text names a subject matching the AVAILABLE SUBJECTS list, put that subject's id in "subjectId". Otherwise "subjectId" is "".
4. "estimatedMinutes" is your best estimate of work time; use 0 if unknown.
5. If the text implies when the student will work on it, put a "schedule" object; else null.
6. Titles should be short and actionable.

OUTPUT — single JSON object:
{
  "assignments": [
    {
      "title": "string",
      "subjectId": "matching subject id or empty",
      "due": "YYYY-MM-DD or empty",
      "estimatedMinutes": 0,
      "notes": "string",
      "schedule": { "date": "YYYY-MM-DD", "hour": 0, "minute": 0 }
    }
  ]
}`;
}

$("#btnParse").onclick = async () => {
  const text = $("#portalInput").value.trim();
  const st = $("#parseStatus");
  const streamBox = $("#parseStream");
  if (!text) { st.textContent = "Paste some text first."; st.className = "status err"; return; }

  $("#btnParse").disabled = true;
  st.textContent = "Thinking…"; st.className = "status";
  streamBox.hidden = false;
  streamBox.textContent = "";
  let cursor = document.createElement("span");
  cursor.className = "cursor";
  streamBox.appendChild(cursor);

  const t0 = performance.now();

  try {
    const out = await callAIStream(text, {
      systemText: buildSystemPrompt(),
      onChunk: (acc) => {
        streamBox.textContent = acc;
        streamBox.appendChild(cursor);
        streamBox.scrollTop = streamBox.scrollHeight;
      }
    });
    const dt = ((performance.now() - t0) / 1000).toFixed(1);

    state.parsed = (out.assignments || []).map(a => ({
      title: a.title || "",
      subjectId: a.subjectId || "",
      due: a.due || "",
      estimatedMinutes: Number(a.estimatedMinutes) || 0,
      notes: a.notes || "",
      schedule: a.schedule || null
    }));
    renderPreview();
    st.textContent = `Parsed ${state.parsed.length} item${state.parsed.length === 1 ? "" : "s"} in ${dt}s.`;
    st.className = "status ok";
    setTimeout(() => { streamBox.hidden = true; }, 800);
  } catch (e) {
    st.textContent = e.message;
    st.className = "status err";
    streamBox.hidden = true;
  } finally {
    $("#btnParse").disabled = false;
  }
};

$("#btnClearPortal").onclick = () => {
  $("#portalInput").value = "";
  state.parsed = [];
  $("#previewWrap").hidden = true;
  $("#parseStatus").textContent = "";
  $("#parseStream").hidden = true;
};

$("#btnDiscardParsed").onclick = () => {
  state.parsed = [];
  $("#previewWrap").hidden = true;
};

function renderPreview() {
  const wrap = $("#previewWrap");
  if (!state.parsed.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  $("#previewList").innerHTML = state.parsed.map((p, i) => `
    <div class="preview-item" data-i="${i}">
      <input class="pv-title" value="${escapeHTML(p.title)}" placeholder="Title">
      <select class="pv-subject">
        <option value="">— No subject —</option>
        ${state.subjects.map(s => `<option value="${s.id}" ${s.id === p.subjectId ? "selected" : ""}>${escapeHTML(s.name)}</option>`).join("")}
      </select>
      <input class="pv-due" type="date" value="${p.due || ""}">
      <input class="pv-mins" type="number" min="0" step="5" value="${p.estimatedMinutes || ""}" placeholder="min">
      <span></span>
      <button class="icon-btn pv-del" data-i="${i}">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`).join("");

  $$("#previewList .preview-item input, #previewList .preview-item select").forEach(inp => {
    inp.oninput = inp.onchange = () => {
      const i = Number(inp.closest(".preview-item").dataset.i);
      const row = inp.closest(".preview-item");
      state.parsed[i].title = row.querySelector(".pv-title").value;
      state.parsed[i].subjectId = row.querySelector(".pv-subject").value;
      state.parsed[i].due = row.querySelector(".pv-due").value;
      state.parsed[i].estimatedMinutes = Number(row.querySelector(".pv-mins").value) || 0;
    };
  });
  $$("#previewList .pv-del").forEach(b => b.onclick = () => {
    state.parsed.splice(Number(b.dataset.i), 1);
    renderPreview();
  });
}

$("#btnSaveParsed").onclick = async () => {
  if (!state.parsed.length) return;
  const batch = writeBatch(db);
  const uid = state.user.uid;
  for (const p of state.parsed) {
    if (!p.title.trim()) continue;
    const ref = doc(collection(db, "users", uid, "assignments"));
    batch.set(ref, {
      title: p.title.trim(),
      subjectId: p.subjectId || "",
      subject: "",
      due: p.due || "",
      estimatedMinutes: p.estimatedMinutes || 0,
      notes: p.notes || "",
      status: "active", source: "ai",
      createdAt: serverTimestamp()
    });
    if (p.schedule && p.schedule.date && Number.isFinite(p.schedule.hour)) {
      const tref = doc(collection(db, "users", uid, "timebox"));
      batch.set(tref, {
        date: p.schedule.date,
        hour: p.schedule.hour,
        minute: p.schedule.minute || 0,
        duration: 30,
        title: p.title.trim(),
        subjectId: p.subjectId || "",
        assignmentId: ref.id,
        type: "assignment",
        createdAt: serverTimestamp()
      });
    }
  }
  await batch.commit();
  state.parsed = [];
  $("#previewWrap").hidden = true;
  $("#portalInput").value = "";
  $("#parseStatus").textContent = "Saved.";
  $("#parseStatus").className = "status ok";
  toast("Assignments saved");
  switchView("home");
};

/* ═══════════════════ SERVICE WORKER ═══════════════════ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("online",  () => toast("Back online"));
window.addEventListener("offline", () => toast("Offline — changes will sync later"));

/* ═══════════════════ BOOT ═══════════════════ */
switchView("home");
renderTimebox();
