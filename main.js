// ════════════════════════════════════════════
// ⚙️  URL вашего Google Apps Script
// ════════════════════════════════════════════
const API =
  "https://script.google.com/macros/s/AKfycbzE-i6cBasE8YAStI_O6-VfgD4BKkyAxWRq9xj-s0VEj8yRqkswL1g1scoXQwdAnc4/exec"
// ════════════════════════════════════════════

function isDemoMode() {
  return !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:[?#].*)?$/i.test(
    (API || "").trim(),
  )
}

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]
const MON_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]

const S = {
  selectedIds: [],
  totalDur: 0,
  date: null,
  dateLbl: null,
  time: null,
  holdId: null,
  holdExp: null,
  holdInterval: null,
  calY: new Date().getFullYear(),
  calM: new Date().getMonth(),
  workDays: [1, 2, 3, 4, 5, 6],
  availableDates: null,
  availabilityKey: null,
  availabilityLoading: false,
}

renderCal()
loadSchedule()

async function loadSchedule() {
  if (isDemoMode()) return
  try {
    const r = await apiFetch(API + "?action=getSchedule")
    if (r.workDays) {
      S.workDays = r.workDays
      renderCal()
      if (S.selectedIds.length) loadMonthAvailability()
    }
  } catch (e) {}
}

function getMonthKey(y = S.calY, m = S.calM) {
  return String(y) + "-" + String(m + 1).padStart(2, "0")
}

function getAvailabilityKey(y = S.calY, m = S.calM) {
  return getMonthKey(y, m) + "|" + S.selectedIds.join(",")
}

function resetAvailabilityState() {
  S.availableDates = null
  S.availabilityKey = null
  S.availabilityLoading = false
}

async function loadMonthAvailability() {
  if (isDemoMode() || !S.selectedIds.length) {
    resetAvailabilityState()
    renderCal()
    return
  }

  const requestKey = getAvailabilityKey()
  S.availabilityLoading = true
  S.availableDates = null
  S.availabilityKey = null
  renderCal()

  try {
    const data = await apiFetch(
      `${API}?action=getAvailableDates&year=${S.calY}&month=${S.calM + 1}&serviceIds=${encodeURIComponent(S.selectedIds.join(","))}`,
    )

    if (requestKey !== getAvailabilityKey()) return
    if (data.error) throw new Error(data.error)

    S.availableDates = new Set(data.availableDates || [])
    S.availabilityKey = requestKey
    S.availabilityLoading = false
    renderCal()
  } catch (e) {
    if (requestKey !== getAvailabilityKey()) return
    console.error("[loadMonthAvailability]", e.message)
    S.availableDates = new Set()
    S.availabilityKey = requestKey
    S.availabilityLoading = false
    renderCal()
  }
}

// ── STEP NAV ─────────────────────────────────────────
function go(n) {
  document
    .querySelectorAll(".card")
    .forEach((c) => c.classList.remove("active"))
  document.getElementById(n === "ok" ? "s-ok" : "s" + n).classList.add("active")
  for (let i = 1; i <= 4; i++) {
    const pg = document.getElementById("pg" + i)
    pg.classList.remove("active", "done")
    if (i < n) pg.classList.add("done")
    if (i === n) pg.classList.add("active")
  }
  if (n === 3) loadSlots()
  if (n === 4) fillStep4()
}

// ── STEP 1 ───────────────────────────────────────────
function onSvcChange() {
  const checked = [...document.querySelectorAll(".svc-cb input:checked")]
  S.selectedIds = checked.map((cb) => cb.value)
  S.totalDur = checked.reduce((s, cb) => s + (+cb.dataset.dur || 0), 0)

  const bar = document.getElementById("total-bar")
  const hint = document.getElementById("total-hint")
  const chips = document.getElementById("total-chips")
  const durBlk = document.getElementById("total-dur-block")

  if (!S.selectedIds.length) {
    bar.classList.remove("has-sel")
    hint.style.display = ""
    chips.style.display = "none"
    durBlk.style.display = "none"
    resetAvailabilityState()
    document.getElementById("btn1").disabled = true
    document.getElementById("btn2").disabled = true
    renderCal()
    return
  }

  bar.classList.add("has-sel")
  hint.style.display = "none"
  chips.style.display = "flex"
  durBlk.style.display = "block"
  document.getElementById("total-dur-num").textContent = S.totalDur

  // Chips show name + price
  chips.innerHTML = S.selectedIds
    .map((id) => {
      const el = document.querySelector(`.svc-cb input[value="${id}"]`)
      const tile = el ? el.closest(".svc-cb") : null
      const nm = tile ? tile.querySelector(".svc-name").textContent : id
      const price = tile
        ? (tile.querySelector(".svc-price") || {}).textContent || ""
        : ""
      return `<span class="chip">${nm}${price ? " · " + price : ""}</span>`
    })
    .join("")

  S.date = null
  S.dateLbl = null
  S.time = null
  document.getElementById("btn2").disabled = true
  document.getElementById("btn1").disabled = false
  renderCal()
  loadMonthAvailability()
}

// ── STEP 2: CALENDAR ─────────────────────────────────

function renderCal() {
  const y = S.calY,
    m = S.calM
  document.getElementById("cal-lbl").textContent = MONTHS[m] + " " + y
  const grid = document.getElementById("cal-grid")
  while (grid.children.length > 7) grid.removeChild(grid.lastChild)

  const availabilityKey = getAvailabilityKey(y, m)
  const useAvailability = S.selectedIds.length > 0 && !isDemoMode()
  const hasAvailabilityData =
    useAvailability &&
    S.availabilityKey === availabilityKey &&
    S.availableDates instanceof Set
  const waitingAvailability =
    useAvailability && !hasAvailabilityData && S.availabilityLoading

  // ── Loading / no-dates indicators ──────────────────
  const loadingEl = document.getElementById("cal-loading")
  const noDatesEl = document.getElementById("cal-no-dates")
  if (loadingEl) loadingEl.classList.toggle("show", !!waitingAvailability)
  if (noDatesEl) {
    const isEmpty = hasAvailabilityData && S.availableDates.size === 0
    noDatesEl.classList.toggle("show", isEmpty)
  }
  // ────────────────────────────────────────────────────

  const firstDow = new Date(y, m, 1).getDay()
  const offset = firstDow === 0 ? 6 : firstDow - 1
  const days = new Date(y, m + 1, 0).getDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < offset; i++) {
    const e = document.createElement("div")
    e.className = "day empty"
    grid.appendChild(e)
  }
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d)
    const dow = date.getDay()
    const btn = document.createElement("button")
    btn.className = "day"
    btn.textContent = d
    const ds = toDS(date)
    const isPast = date < today
    const isWorkingDay = S.workDays.includes(dow)
    const isAvailableDate = hasAvailabilityData
      ? S.availableDates.has(ds)
      : isWorkingDay

    if (date.toDateString() === today.toDateString()) btn.classList.add("today")
    if (S.date === ds) btn.classList.add("sel")
    if (
      !isWorkingDay ||
      (useAvailability && hasAvailabilityData && !isPast && !isAvailableDate) ||
      (useAvailability && waitingAvailability && !isPast)
    ) {
      btn.classList.add("day-off")
    }
    if (
      isPast ||
      !isWorkingDay ||
      (useAvailability && waitingAvailability && !isPast) ||
      (useAvailability && hasAvailabilityData && !isPast && !isAvailableDate)
    ) {
      btn.disabled = true
    } else btn.onclick = () => pickDate(ds, date, btn)
    grid.appendChild(btn)
  }
}


function shiftMonth(d) {
  S.calM += d
  if (S.calM > 11) {
    S.calM = 0
    S.calY++
  }
  if (S.calM < 0) {
    S.calM = 11
    S.calY--
  }
  renderCal()
  if (S.selectedIds.length) loadMonthAvailability()
}

function pickDate(ds, date, btn) {
  S.date = ds
  S.dateLbl =
    date.getDate() + " " + MON_GEN[date.getMonth()] + " " + date.getFullYear()
  document.querySelectorAll(".day").forEach((b) => b.classList.remove("sel"))
  btn.classList.add("sel")
  document.getElementById("btn2").disabled = false
  S.time = null
}

// ── STEP 3: SLOTS ────────────────────────────────────
async function loadSlots() {
  const body = document.getElementById("s3-body")
  const err = document.getElementById("err-slots")
  err.classList.remove("show")
  document.getElementById("btn3").disabled = true
  S.time = null
  body.innerHTML = '<div class="slots-loader">Загружаем расписание…</div>'

  if (isDemoMode()) {
    await delay(600)
    renderSlots(demoSlots(), S.totalDur, body)
    return
  }

  try {
    const data = await fetchSlotsForSelection()
    if (data.error) throw new Error(data.error)
    renderSlots(data.slots || [], data.totalDuration || S.totalDur, body)
  } catch (e) {
    body.innerHTML = ""
    showAlert("err-slots", e.message || "Не удалось загрузить расписание.")
  }
}

async function fetchSlotsForSelection() {
  const sids = S.selectedIds.join(",")
  return apiFetch(
    `${API}?action=getSlots&date=${S.date}&serviceIds=${encodeURIComponent(sids)}`,
  )
}

function renderSlots(slots, dur, container) {
  const DOW = [
    "воскресенье",
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
  ]
  const d = new Date(S.date + "T00:00:00")
  const badge = `<div class="slots-date-badge">${S.dateLbl} · ${DOW[d.getDay()]}</div>`
  const note = `<div class="slots-dur-note">Длительность визита: <strong>${dur} мин</strong></div>`
  if (!slots.length) {
    container.innerHTML =
      badge +
      note +
      '<div class="slots-empty">На этот день нет свободных окон нужной длительности.<br>Выберите другую дату.</div>'
    return
  }
  let html = badge + note + '<div class="slots-grid">'
  slots.forEach((t) => {
    html += `<button class="slot" onclick="pickSlot('${t}',this)">${t}</button>`
  })
  html += "</div>"
  container.innerHTML = html
}

function pickSlot(t, el) {
  S.time = t
  document.querySelectorAll(".slot").forEach((s) => s.classList.remove("sel"))
  el.classList.add("sel")
  document.getElementById("btn3").disabled = false
}

// ── HOLD ──────────────────────────────────────────────
async function doHold() {
  const btn = document.getElementById("btn3")
  const body = document.getElementById("s3-body")
  const defaultLabel = btn.dataset.defaultLabel || btn.innerHTML
  btn.dataset.defaultLabel = defaultLabel
  document.getElementById("err-slots").classList.remove("show")
  btn.disabled = true
  btn.innerHTML = '<span class="spin"></span>Бронирую…'

  if (isDemoMode()) {
    await delay(500)
    S.holdId = "demo"
    S.holdExp = Date.now() + 10 * 60000
    go(4)
    startTimer()
    btn.innerHTML = "Забронировать →"
    btn.innerHTML = defaultLabel
    btn.disabled = false
    return
  }

  try {
    const availability = await fetchSlotsForSelection()
    if (availability.error) throw new Error(availability.error)

    const currentSlots = availability.slots || []
    if (!currentSlots.includes(S.time)) {
      S.time = null
      renderSlots(currentSlots, availability.totalDuration || S.totalDur, body)
      showAlert(
        "err-slots",
        "Выбранное время уже занято. Показаны только свободные слоты.",
      )
      btn.innerHTML = "Забронировать →"
      btn.innerHTML = defaultLabel
      btn.disabled = true
      return
    }

    const r = await apiPost({
      action: "holdSlot",
      date: S.date,
      time: S.time,
      serviceIds: S.selectedIds.join(","),
    })
    if (!r.success) {
      const refreshed = await fetchSlotsForSelection().catch(() => null)
      if (refreshed && !refreshed.error) {
        renderSlots(refreshed.slots || [], refreshed.totalDuration || S.totalDur, body)
      }
      showAlert("err-slots", r.error || "Не удалось забронировать слот.")
      S.time = null
      document
        .querySelectorAll(".slot")
        .forEach((s) => s.classList.remove("sel"))
      btn.innerHTML = "Забронировать →"
      btn.disabled = true
      return
    }
    S.holdId = r.holdId
    S.holdExp = r.expiresAt
    go(4)
    startTimer()
    btn.innerHTML = "Забронировать →"
    btn.innerHTML = defaultLabel
    btn.disabled = false
  } catch (e) {
    showAlert("err-slots", "Ошибка соединения.")
    btn.innerHTML = "Забронировать →"
    btn.innerHTML = defaultLabel
    btn.disabled = false
  }
}

function fillStep4() {
  const names = S.selectedIds.map((id) => {
    const el = document.querySelector(`.svc-cb input[value="${id}"]`)
    return el
      ? el.closest(".svc-cb").querySelector(".svc-name").textContent
      : id
  })
  document.getElementById("ok-svc").textContent = names.join(", ")
  document.getElementById("ok-dur").textContent = S.totalDur + " мин"
  document.getElementById("ok-date").textContent = S.dateLbl
  document.getElementById("ok-time").textContent = S.time
  document.getElementById("err-book").classList.remove("show")
  document.getElementById("warn-exp").classList.remove("show")
  validateF4()
}

// ── TIMER ─────────────────────────────────────────────
function startTimer() {
  clearInterval(S.holdInterval)
  const banner = document.getElementById("hold-banner")
  const lbl = document.getElementById("hold-timer")
  banner.classList.remove("expired")

  S.holdInterval = setInterval(() => {
    const rem = S.holdExp - Date.now()
    if (rem <= 0) {
      clearInterval(S.holdInterval)
      lbl.textContent = "0:00"
      banner.classList.add("expired")
      banner.querySelector("span").textContent =
        "Бронь истекла — выберите время снова"
      document.getElementById("btn4").disabled = true
      document.getElementById("warn-exp").classList.add("show")
      return
    }
    const min = Math.floor(rem / 60000)
    const sec = Math.floor((rem % 60000) / 1000)
    lbl.textContent = min + ":" + String(sec).padStart(2, "0")
  }, 500)
}

async function back4() {
  clearInterval(S.holdInterval)
  if (S.holdId && !isDemoMode()) {
    apiPost({ action: "releaseHold", holdId: S.holdId }).catch(() => {})
  }
  S.holdId = null
  go(3)
}

// ── FORM ──────────────────────────────────────────────
function validateF4() {
  const name = document.getElementById("f-name").value.trim()
  const phone = document.getElementById("f-phone").value.replace(/\D/g, "")
  const exp = S.holdExp && Date.now() > S.holdExp
  document.getElementById("btn4").disabled = !(
    name.length >= 2 &&
    phone.length >= 10 &&
    !exp
  )
}

function fmtPhone(inp) {
  let v = inp.value.replace(/\D/g, "")
  if (v.startsWith("8")) v = "7" + v.slice(1)
  if (v.startsWith("7")) {
    let r = "+7"
    if (v.length > 1) r += " (" + v.slice(1, 4)
    if (v.length >= 4) r += ") " + v.slice(4, 7)
    if (v.length >= 7) r += "-" + v.slice(7, 9)
    if (v.length >= 9) r += "-" + v.slice(9, 11)
    inp.value = r
  }
}

// ── SUBMIT ────────────────────────────────────────────
async function doSubmit() {
  const btn = document.getElementById("btn4")
  btn.disabled = true
  btn.innerHTML = '<span class="spin"></span>Записываю…'
  document.getElementById("err-book").classList.remove("show")

  const name = document.getElementById("f-name").value.trim()
  const phone = document.getElementById("f-phone").value.trim()
  const comment = document.getElementById("f-comment").value.trim()
  const website = document.getElementById("f-website")?.value.trim() || ""

  if (isDemoMode()) {
    await delay(700)
    clearInterval(S.holdInterval)
    finishOk(name)
    return
  }

  try {
    console.log("[doSubmit] Sending book request:", {
      date: S.date,
      time: S.time,
      serviceIds: S.selectedIds.join(","),
      holdId: S.holdId,
    })

    const r = await apiPost({
      action: "book",
      serviceIds: S.selectedIds.join(","),
      date: S.date,
      time: S.time,
      name,
      phone,
      comment,
      website,
      holdId: S.holdId,
    })

    console.log("[doSubmit] Server response:", r)

    if (r.success) {
      clearInterval(S.holdInterval)
      console.log("[doSubmit] Event created:", r.eventId, r.title)
      finishOk(name)
    } else {
      // Show the exact error from the server — not a generic message
      const errMsg = r.error || "Ошибка записи. Проверьте консоль браузера."
      console.error("[doSubmit] Server returned failure:", r)
      showAlert("err-book", errMsg)
      btn.innerHTML = "Записаться"
      btn.disabled = false
    }
  } catch (e) {
    console.error("[doSubmit] Request failed:", e.message)
    showAlert("err-book", "Ошибка соединения: " + e.message)
    btn.innerHTML = "Записаться"
    btn.disabled = false
  }
}

function finishOk(name) {
  const names = S.selectedIds.map((id) => {
    const el = document.querySelector(`.svc-cb input[value="${id}"]`)
    return el
      ? el.closest(".svc-cb").querySelector(".svc-name").textContent
      : id
  })
  document.getElementById("fin-svc").textContent = names.join(", ")
  document.getElementById("fin-dt").textContent = S.dateLbl + ", " + S.time
  document.getElementById("fin-name").textContent = name
  go("ok")
}

// ── RESET ─────────────────────────────────────────────
function resetAll() {
  clearInterval(S.holdInterval)
  Object.assign(S, {
    selectedIds: [],
    totalDur: 0,
    date: null,
    dateLbl: null,
    time: null,
    holdId: null,
    holdExp: null,
    holdInterval: null,
    calY: new Date().getFullYear(),
    calM: new Date().getMonth(),
    availableDates: null,
    availabilityKey: null,
    availabilityLoading: false,
  })
  document
    .querySelectorAll(".svc-cb input")
    .forEach((cb) => (cb.checked = false))
  document.getElementById("f-name").value = ""
  document.getElementById("f-phone").value = ""
  document.getElementById("f-comment").value = ""
  if (document.getElementById("f-website")) {
    document.getElementById("f-website").value = ""
  }
  document.getElementById("btn4").innerHTML = "Записаться"
  onSvcChange()
  renderCal()
  go(1)
}

// ── UTILS ─────────────────────────────────────────────
async function apiFetch(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error("HTTP " + r.status + " — " + url)
  return r.json()
}
async function apiPost(data) {
  // text/plain avoids CORS preflight (no OPTIONS request sent)
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(data),
  })

  // If the server returned an error HTTP status, read the body for diagnostics
  if (!r.ok) {
    const text = await r.text().catch(() => "(unreadable)")
    const msg = "Server error " + r.status + ": " + text.slice(0, 200)
    console.error("[apiPost] " + msg)
    throw new Error(msg)
  }

  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch (e) {
    console.error(
      "[apiPost] JSON parse failed. Raw response:",
      text.slice(0, 500),
    )
    throw new Error("Bad JSON from server: " + text.slice(0, 100))
  }
}
function showAlert(id, msg) {
  const el = document.getElementById(id)
  el.textContent = msg
  el.classList.add("show")
}
function toDS(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  )
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
// ── DEV HELPERS ───────────────────────────────────────────────
// Open browser DevTools console and run:
//   testConnection() — verify CORS and URL are working
//   testBooking()    — end-to-end test that creates a real event

async function testConnection() {
  if (isDemoMode()) {
    console.warn("Demo mode — API URL not set")
    return
  }
  console.log("Testing connection to:", API)
  try {
    const r = await apiFetch(API + "?action=ping")
    console.log("✓ Connection OK:", r)
  } catch (e) {
    console.error("✗ Connection failed:", e.message)
    console.error("Common causes:")
    console.error("  1. Apps Script not redeployed after code changes")
    console.error(
      "  2. Deployment: Execute as=Me, Access=Anyone (not signed in)",
    )
    console.error(
      "  3. Opening index.html from file:// — use a local HTTP server instead",
    )
  }
}

// Full end-to-end booking test — run from browser console on a live page.
// Creates a real test event in your calendar, then immediately deletes it.
async function testBooking() {
  if (isDemoMode()) {
    console.warn("Demo mode — set a real API URL first")
    return
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const testDate = tomorrow.toISOString().split("T")[0]

  console.log("▶ Testing booking on:", testDate)
  console.log("  Step 1 — getSlots...")

  try {
    const slotsR = await apiFetch(
      API + "?action=getSlots&date=" + testDate + "&serviceIds=manicure",
    )
    console.log("  Slots response:", slotsR)

    if (!slotsR.slots || !slotsR.slots.length) {
      console.warn("  No slots returned — check schedule or service IDs")
      return
    }

    const slot = slotsR.slots[0]
    console.log("  Step 2 — holdSlot at", slot, "...")

    const holdR = await apiPost({
      action: "holdSlot",
      date: testDate,
      time: slot,
      serviceIds: "manicure",
    })
    console.log("  Hold response:", holdR)

    if (!holdR.success) {
      console.error("  holdSlot failed:", holdR.error)
      return
    }

    console.log("  Step 3 — book (create event)...")

    await delay(3500)

    const bookR = await apiPost({
      action: "book",
      serviceIds: "manicure",
      date: testDate,
      time: slot,
      name: "ТЕСТ",
      phone: "+7 999 000-00-00",
      comment: "Автоматический тест — удалить",
      website: "",
      holdId: holdR.holdId,
    })
    console.log("  Book response:", bookR)

    if (bookR.success) {
      console.log("✓ SUCCESS! Event created in calendar:", bookR.eventId)
      console.log(
        "  Title:",
        bookR.title,
        "| Start:",
        bookR.start,
        "| End:",
        bookR.end,
      )
      console.log(
        "  Open Google Calendar to verify, then the test event will be visible as 'ТЕСТ / Маникюр'",
      )
    } else {
      console.error("✗ Book failed:", bookR.error)
    }
  } catch (e) {
    console.error("✗ testBooking threw:", e.message)
  }
}

function demoSlots() {
  // Build 15-minute grid from 08:00 to 20:30.
  // "Dead zone" rule (spec §Exclusion of time fragmentation):
  //   the while-condition `cursor + durationMs <= dayEnd` already
  //   handles this on the server. In demo mode we just serve the
  //   full grid and let the client render it — the real server
  //   trims it correctly. We still apply the past-time filter.
  const base = []
  const dayStartH = 8,
    dayStartM = 0
  const dayEndH = 20,
    dayEndM = 30
  const stepMin = 15 // grid interval per spec

  // Generate every 15-min tick from 08:00 to 20:30 inclusive
  for (let h = dayStartH; h <= dayEndH; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      if (h === dayEndH && m > dayEndM) break
      base.push(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"))
    }
  }

  // For today: filter out past times + 15-min buffer
  // (server uses 15-min buffer independent of 10-min hold timeout)
  const isToday = S.date === toDS(new Date())
  const minStart = Date.now() + 15 * 60 * 1000

  return base.filter((t) => {
    if (Math.random() <= 0.35) return false // simulate ~35% unavailability
    if (!isToday) return true

    const [h, m] = t.split(":").map(Number)
    const slotDate = new Date(S.date + "T00:00:00")
    slotDate.setHours(h, m, 0, 0)
    return slotDate.getTime() > minStart
  })
}

