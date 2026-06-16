const API =
  "https://script.google.com/macros/s/AKfycbxks-NIPlXfMIxD1SrLHFQPjdgeCGO9jsO53yvQAr8MvARfE5sN7Hf_jUhJfuWuCOY/exec"
const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
const MONTHS = [
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
const DEFAULT_SCHEDULE = {
  0: null,
  1: { start: "08:00", end: "21:00", breaks: [] },
  2: { start: "08:00", end: "21:00", breaks: [] },
  3: { start: "08:00", end: "21:00", breaks: [] },
  4: { start: "08:00", end: "21:00", breaks: [] },
  5: { start: "08:00", end: "21:00", breaks: [] },
  6: { start: "08:00", end: "21:00", breaks: [] },
}

const state = {
  password: sessionStorage.getItem("miraAdminPassword") || "",
  activeView: "dashboard",
  calendarMode: "week",
  currentDate: startOfDay(new Date()),
  services: [],
  appointments: [],
  blocks: [],
  hours: [],
  modalSlot: "",
  modalAppointment: null,
}

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector))

document.addEventListener("DOMContentLoaded", init)

function init() {
  $("#loginForm").addEventListener("submit", handleLogin)
  $("#logoutBtn").addEventListener("click", logout)
  $("#saveHoursBtn").addEventListener("click", saveCustomHours)
  $("#removeHoursByDateBtn").addEventListener("click", removeCustomHoursByDate)
  $("#saveBlockBtn").addEventListener("click", saveBlock)
  $("#appointmentSearch").addEventListener("input", renderAppointments)
  document.addEventListener("click", handleDocumentClick)

  const today = isoDate(new Date())
  $("#hoursDate").value = today
  $("#blockDate").value = today

  if (state.password) {
    $("#passwordInput").value = state.password
    login(true)
  }
}

async function handleLogin(event) {
  event.preventDefault()
  state.password = $("#passwordInput").value.trim()
  if (!state.password) {
    $("#loginError").textContent = "Введите пароль администратора."
    return
  }
  await login(false)
}

async function login(silent) {
  $("#loginBtn").disabled = true
  $("#loginError").textContent = silent ? "Проверяем сохраненный доступ..." : ""
  try {
    await loadServices()
    await reloadAll()
    sessionStorage.setItem("miraAdminPassword", state.password)
    $("#loginScreen").classList.add("hidden")
    $("#app").classList.remove("hidden")
    $("#loginError").textContent = ""
  } catch (error) {
    sessionStorage.removeItem("miraAdminPassword")
    $("#loginError").textContent = silent
      ? ""
      : error.message || "Не удалось войти."
    state.password = ""
  } finally {
    $("#loginBtn").disabled = false
  }
}

function logout() {
  sessionStorage.removeItem("miraAdminPassword")
  state.password = ""
  $("#app").classList.add("hidden")
  $("#loginScreen").classList.remove("hidden")
  $("#passwordInput").value = ""
  $("#passwordInput").focus()
}

async function loadServices() {
  const data = await apiGet("getServices")
  state.services = normalizeServices(data.services)
}

function normalizeServices(services) {
  if (Array.isArray(services)) {
    return services
      .map((service) => ({
        id: String(service.id || service.key || "").trim(),
        label: String(service.label || service.name || service.id || "").trim(),
        duration: Number(service.duration || service.minutes || 0),
      }))
      .filter((service) => service.id && service.label && service.duration > 0)
  }

  return Object.entries(services || {})
    .map(([id, service]) => ({
      id,
      label: String((service && service.label) || id),
      duration: Number((service && service.duration) || 0),
    }))
    .filter((service) => service.id && service.label && service.duration > 0)
}

async function reloadAll() {
  setStatus("Загружаем данные из Google Calendar...")
  const range = getDataRange()
  const appointmentsData = await adminGet("getAppointments", range)
  const blocksData = await loadOptionalAdminData(
    "getBlocks",
    {},
    { blocks: [] },
  )
  const hoursData = await loadOptionalAdminData("getCustomHours", range, {
    hours: [],
  })

  state.appointments = appointmentsData.appointments || []
  state.blocks = blocksData.blocks || []
  state.hours = hoursData.hours || []
  renderAll()
  setStatus(
    "Обновлено: " +
      new Date().toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
  )
}

async function loadOptionalAdminData(action, params, fallback) {
  try {
    return await adminGet(action, params)
  } catch (error) {
    console.warn(action + " failed:", error)
    showToast("Часть данных недоступна: " + error.message)
    return fallback
  }
}

function getDataRange() {
  const from = startOfMonth(addMonths(state.currentDate, -1))
  const to = endOfMonth(addMonths(state.currentDate, 2))
  return { from: isoDate(from), to: isoDate(to) }
}

async function apiGet(action, params = {}) {
  const url = new URL(API)
  url.searchParams.set("action", action)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value)
    }
  })
  const response = await fetch(url.toString())
  const data = await readJsonResponse(response)
  if (data.unauthorized || data.error)
    throw new Error(data.error || "Ошибка запроса")
  return data
}

async function apiPost(action, payload = {}) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  })
  const data = await readJsonResponse(response)
  if (data.unauthorized || data.error)
    throw new Error(data.error || "Ошибка запроса")
  return data
}

async function readJsonResponse(response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      "Сервер вернул не JSON. Проверьте URL Apps Script и новое развертывание.",
    )
  }
}

function adminGet(action, params = {}) {
  return apiGet(action, { ...params, password: state.password })
}

function adminPost(action, payload = {}) {
  return apiPost(action, { ...payload, password: state.password })
}

function renderAll() {
  renderTopbar()
  renderDashboard()
  renderCalendar()
  renderAppointments()
  renderSchedule()
  updateNav()
}

function renderTopbar() {
  const title = $("#rangeTitle")
  const subtitle = $("#rangeSubtitle")
  if (state.activeView === "dashboard") {
    title.textContent = "Сегодня"
    subtitle.textContent =
      formatDateLong(isoDate(new Date())) +
      " · живая синхронизация с Google Calendar"
    return
  }
  if (state.activeView === "calendar") {
    title.textContent = calendarTitle()
    subtitle.textContent = "Режим: " + modeLabel(state.calendarMode)
    return
  }
  if (state.activeView === "appointments") {
    title.textContent = "Записи"
    subtitle.textContent =
      "Период: " +
      formatDateShort(getDataRange().from) +
      " - " +
      formatDateShort(getDataRange().to)
    return
  }
  title.textContent = "График"
  subtitle.textContent = "Нестандартные рабочие дни и блокировки календаря"
}

function renderDashboard() {
  const today = isoDate(new Date())
  const list = appointmentsForDate(today)
  const minutes = list.reduce(
    (sum, item) => sum + Number(item.duration || 0),
    0,
  )
  const next = list.find(
    (item) => timeToMinutes(item.startTime) >= timeToMinutes(nowTimeString()),
  )

  $("#metricToday").textContent = list.length
  $("#metricMinutes").textContent = minutes
  $("#metricNext").textContent = next ? next.startTime : "-"
  $("#todayCountBadge").textContent = list.length
  $("#allCountBadge").textContent = state.appointments.length
  $("#todayTimeline").innerHTML = renderTimeline(today, list)
}

function renderTimeline(dateStr, list) {
  const hours = getEffectiveHours(dateStr)
  if (!hours) {
    return `<div class="timeline-empty">День закрыт. Чтобы открыть запись, добавьте нестандартный рабочий день в разделе "График".</div>`
  }

  const start = timeToMinutes(hours.start)
  const end = timeToMinutes(hours.end)
  const total = Math.max(60, end - start)
  const height = Math.max(520, Math.ceil(total / 60) * 72)
  const ticks = []
  for (let minute = start; minute <= end; minute += 60) {
    const top = ((minute - start) / total) * 100
    ticks.push(
      `<div class="tick" style="top:${top}%"><span>${minutesToTime(minute)}</span></div>`,
    )
  }

  const events = list
    .map((item) => {
      const itemStart = Math.max(start, timeToMinutes(item.startTime))
      const itemEnd = Math.min(end, timeToMinutes(item.endTime))
      const top = ((itemStart - start) / total) * 100
      const eventHeight = Math.max(9, ((itemEnd - itemStart) / total) * 100)
      return `
          <article class="timeline-event" style="top:${top}%;height:${eventHeight}%">
            <strong>${escapeHtml(item.startTime)}-${escapeHtml(item.endTime)} · ${escapeHtml(item.clientName || item.title)}</strong>
            <small>${escapeHtml(item.service || "Услуга не указана")} · ${escapeHtml(item.phone || "без телефона")}</small>
            <div class="toolbar">
              <button class="btn ghost small" type="button" data-open-reschedule data-id="${encodeId(item.id)}">Перенести</button>
              <button class="btn danger small" type="button" data-cancel data-id="${encodeId(item.id)}">Удалить</button>
            </div>
          </article>
        `
    })
    .join("")

  const empty = list.length
    ? ""
    : `<div class="timeline-empty">На этот день пока нет записей.</div>`
  return `<div class="timeline" style="height:${height}px">${ticks.join("")}${events}${empty}</div>`
}

function renderCalendar() {
  $$(".segmented [data-mode]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.mode === state.calendarMode,
    )
  })
  const board = $("#calendarBoard")
  if (state.calendarMode === "day") {
    const date = isoDate(state.currentDate)
    board.innerHTML = `<div class="card pad">${renderTimeline(date, appointmentsForDate(date))}</div>`
    return
  }
  if (state.calendarMode === "week") {
    board.innerHTML = renderWeek()
    return
  }
  board.innerHTML = renderMonth()
}

function renderWeek() {
  const start = startOfWeek(state.currentDate)
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))
  return `
        <div class="week-board">
          ${days.map((day) => renderWeekDay(isoDate(day))).join("")}
        </div>
      `
}

function renderWeekDay(dateStr) {
  const list = appointmentsForDate(dateStr)
  const hours = getEffectiveHours(dateStr)
  const blocks = blocksForDate(dateStr)
  return `
        <article class="week-day ${hours ? "" : "off"}">
          <div class="day-title">
            <span>${WEEKDAYS[parseIsoDate(dateStr).getDay()]}</span>
            <b>${parseIsoDate(dateStr).getDate()}</b>
          </div>
          <div class="badges">
            ${hours ? `<span class="badge green">${hours.start}-${hours.end}</span>` : `<span class="badge red">выходной</span>`}
            ${blocks.length ? `<span class="badge red">блоков: ${blocks.length}</span>` : ""}
          </div>
          ${list.length ? list.map(renderAppointmentChip).join("") : `<div class="empty" style="padding:16px;margin-top:10px">Нет записей</div>`}
          <button class="btn ghost small" style="width:100%;margin-top:10px" type="button" data-open-create data-date="${dateStr}">Добавить</button>
        </article>
      `
}

function renderMonth() {
  const first = startOfMonth(state.currentDate)
  const gridStart = startOfWeek(first)
  const currentMonth = state.currentDate.getMonth()
  const cells = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  )
  return `
        <div class="month-grid">
          ${cells.map((day) => renderMonthCell(day, currentMonth)).join("")}
        </div>
      `
}

function renderMonthCell(day, currentMonth) {
  const dateStr = isoDate(day)
  const list = appointmentsForDate(dateStr)
  const hours = getEffectiveHours(dateStr)
  const blocks = blocksForDate(dateStr)
  const classes = [
    "month-cell",
    day.getMonth() !== currentMonth ? "outside" : "",
    sameDate(day, new Date()) ? "today" : "",
    hours ? "" : "off",
  ]
    .filter(Boolean)
    .join(" ")
  return `
        <article class="${classes}" data-calendar-date="${dateStr}">
          <div class="day-title">
            <span>${WEEKDAYS[day.getDay()]}</span>
            <b>${day.getDate()}</b>
          </div>
          <div class="badges">
            ${hours ? `<span class="badge green">${hours.start}-${hours.end}</span>` : `<span class="badge red">закрыто</span>`}
            ${blocks.length ? `<span class="badge red">блок</span>` : ""}
          </div>
          ${list.slice(0, 3).map(renderAppointmentChip).join("")}
          ${list.length > 3 ? `<span class="badge blue">еще ${list.length - 3}</span>` : ""}
        </article>
      `
}

function renderAppointmentChip(item) {
  return `
        <div class="appointment-chip">
          <strong>${escapeHtml(item.startTime)} · ${escapeHtml(item.clientName || item.title)}</strong>
          <span>${escapeHtml(item.service || "Услуга")} · ${escapeHtml(item.phone || "")}</span>
        </div>
      `
}

function renderAppointments() {
  const query = ($("#appointmentSearch").value || "").trim().toLowerCase()
  const list = state.appointments.filter((item) => {
    if (!query) return true
    return [item.clientName, item.title, item.service, item.phone, item.comment]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })

  $("#appointmentsList").innerHTML = list.length
    ? list
        .map(
          (item) => `
        <article class="list-row">
          <div>
            <strong>${escapeHtml(item.dateFmt || formatDateShort(item.date))}</strong>
            <div class="muted">${escapeHtml(item.weekday || "")} · ${escapeHtml(item.startTime)}-${escapeHtml(item.endTime)}</div>
          </div>
          <div>
            <strong>${escapeHtml(item.clientName || item.title)}</strong>
            <div class="muted">${escapeHtml(item.phone || "Телефон не указан")}</div>
          </div>
          <div>
            <strong>${escapeHtml(item.service || "Услуга не указана")}</strong>
            <div class="muted">${Number(item.duration || 0)} мин</div>
          </div>
          <div class="row-actions">
            <button class="btn ghost small" type="button" data-open-reschedule data-id="${encodeId(item.id)}">Перенести</button>
            <button class="btn danger small" type="button" data-cancel data-id="${encodeId(item.id)}">Удалить</button>
          </div>
        </article>
      `,
        )
        .join("")
    : `<div class="empty">Записей в выбранном периоде нет.</div>`
}

function renderSchedule() {
  $("#customHoursList").innerHTML = state.hours.length
    ? state.hours
        .map(
          (item) => `
        <article class="list-row" style="grid-template-columns:1fr auto">
          <div>
            <strong>${escapeHtml(item.dateFmt)} · ${escapeHtml(item.start)}-${escapeHtml(item.end)}</strong>
            <div class="muted">${escapeHtml(item.weekday || "")}${item.breaks && item.breaks.length ? " · перерывы: " + escapeHtml(item.breaks.map((br) => br.start + "-" + br.end).join(", ")) : ""}</div>
          </div>
          <div class="row-actions">
            <button class="btn danger small" type="button" data-remove-hours data-id="${encodeId(item.id)}">Удалить</button>
          </div>
        </article>
      `,
        )
        .join("")
    : `<div class="empty">Нестандартные рабочие дни пока не заданы.</div>`

  $("#blocksList").innerHTML = state.blocks.length
    ? state.blocks
        .map(
          (item) => `
        <article class="list-row" style="grid-template-columns:1fr auto">
          <div>
            <strong>${escapeHtml(item.dateFmt)} · ${item.fullDay ? "весь день" : escapeHtml(item.start + "-" + item.end)}</strong>
            <div class="muted">${escapeHtml(item.label || item.title || "Блокировка")}</div>
          </div>
          <div class="row-actions">
            <button class="btn danger small" type="button" data-remove-block data-id="${encodeId(item.id)}">Удалить</button>
          </div>
        </article>
      `,
        )
        .join("")
    : `<div class="empty">Будущих блокировок нет.</div>`
}

function updateNav() {
  $$("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === state.activeView)
  })
  $$("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle(
      "hidden",
      panel.dataset.viewPanel !== state.activeView,
    )
  })
}

async function handleDocumentClick(event) {
  const nav = event.target.closest("[data-nav]")
  if (nav) {
    state.activeView = nav.dataset.nav
    renderAll()
    return
  }

  const mode = event.target.closest("[data-mode]")
  if (mode) {
    state.calendarMode = mode.dataset.mode
    renderAll()
    return
  }

  if (event.target.closest("[data-prev]")) {
    await shiftPeriod(-1)
    return
  }

  if (event.target.closest("[data-next]")) {
    await shiftPeriod(1)
    return
  }

  if (event.target.closest("[data-today]")) {
    state.currentDate = startOfDay(new Date())
    await reloadAll()
    return
  }

  if (event.target.closest("[data-refresh]")) {
    await reloadAll()
    showToast("Данные обновлены")
    return
  }

  const create = event.target.closest("[data-open-create]")
  if (create) {
    openCreateModal(create.dataset.date || isoDate(state.currentDate))
    return
  }

  const dateCell = event.target.closest("[data-calendar-date]")
  if (dateCell) {
    state.currentDate = parseIsoDate(dateCell.dataset.calendarDate)
    state.calendarMode = "day"
    renderAll()
    return
  }

  const reschedule = event.target.closest("[data-open-reschedule]")
  if (reschedule) {
    openRescheduleModal(decodeId(reschedule.dataset.id))
    return
  }

  const cancel = event.target.closest("[data-cancel]")
  if (cancel) {
    await cancelBooking(decodeId(cancel.dataset.id))
    return
  }

  const removeBlock = event.target.closest("[data-remove-block]")
  if (removeBlock) {
    await deleteBlock(decodeId(removeBlock.dataset.id))
    return
  }

  const removeHours = event.target.closest("[data-remove-hours]")
  if (removeHours) {
    await deleteCustomHours(decodeId(removeHours.dataset.id))
    return
  }

  if (
    event.target.matches("[data-close-modal]") ||
    event.target.id === "modalBackdrop"
  ) {
    closeModal()
  }
}

async function shiftPeriod(direction) {
  if (state.calendarMode === "month")
    state.currentDate = addMonths(state.currentDate, direction)
  if (state.calendarMode === "week")
    state.currentDate = addDays(state.currentDate, direction * 7)
  if (state.calendarMode === "day")
    state.currentDate = addDays(state.currentDate, direction)
  await reloadAll()
}

function openCreateModal(dateStr) {
  state.modalSlot = ""
  $("#modal").innerHTML = `
        <div class="modal-head">
          <div>
            <h3>Новая запись</h3>
            <p class="muted">Админская запись сразу создается в Google Calendar.</p>
          </div>
          <button class="btn ghost small" type="button" data-close-modal>Закрыть</button>
        </div>
        <form id="createForm" class="modal-body">
          <div class="grid cols-2">
            <div class="field">
              <label for="createDate">Дата</label>
              <input id="createDate" type="date" value="${escapeAttr(dateStr)}">
            </div>
            <div class="field">
              <label>Длительность</label>
              <input id="createDuration" type="text" value="Выберите услуги" disabled>
            </div>
          </div>
          <div class="field">
            <label>Услуги</label>
            <div class="service-picker">
              ${state.services
                .map(
                  (service) => `
                <label class="service-option">
                  <input class="create-service" type="checkbox" value="${escapeAttr(service.id)}">
                  <span>${escapeHtml(service.label)} · ${Number(service.duration || 0)} мин</span>
                </label>
              `,
                )
                .join("")}
            </div>
          </div>
          <div class="field">
            <label>Свободное время из Google Calendar</label>
            <div id="createSlots" class="slot-grid"></div>
            <p id="createSlotMessage" class="muted"></p>
          </div>
          <div class="grid cols-2">
            <div class="field">
              <label for="createName">Имя клиента</label>
              <input id="createName" type="text" required placeholder="Например, Варвара">
            </div>
            <div class="field">
              <label for="createPhone">Телефон</label>
              <input id="createPhone" type="tel" required placeholder="+7...">
            </div>
          </div>
          <div class="field">
            <label for="createComment">Комментарий</label>
            <textarea id="createComment" placeholder="Источник записи, пожелания клиента"></textarea>
          </div>
          <p id="createError" class="error"></p>
          <div class="toolbar">
            <button id="createSubmit" class="btn primary" type="submit">Создать запись</button>
            <button class="btn ghost" type="button" data-close-modal>Отмена</button>
          </div>
        </form>
      `
  $("#modalBackdrop").classList.remove("hidden")
  $("#createForm").addEventListener("submit", submitCreateBooking)
  $("#createDate").addEventListener("change", refreshCreateSlots)
  $$(".create-service").forEach((input) =>
    input.addEventListener("change", refreshCreateSlots),
  )
  $("#createSlots").addEventListener("click", selectModalSlot)
  refreshCreateSlots()
}

async function refreshCreateSlots() {
  const date = $("#createDate").value
  const ids = selectedCreateServiceIds()
  const message = $("#createSlotMessage")
  const slots = $("#createSlots")
  const duration = ids.reduce((sum, id) => {
    const service = state.services.find((item) => item.id === id)
    return sum + Number(service ? service.duration : 0)
  }, 0)
  $("#createDuration").value = duration ? duration + " мин" : "Выберите услуги"
  state.modalSlot = ""

  if (!date || !ids.length) {
    slots.innerHTML = ""
    message.textContent = "Выберите дату и хотя бы одну услугу."
    return
  }

  message.textContent = "Проверяем свободные окна..."
  slots.innerHTML = ""
  try {
    const data = await apiGet("getSlots", { date, serviceIds: ids.join(",") })
    renderSlotButtons(slots, data.slots || [])
    message.textContent =
      data.slots && data.slots.length
        ? "Показаны только слоты, полностью свободные в календаре."
        : "На эту дату свободных слотов для выбранных услуг нет."
  } catch (error) {
    message.textContent = error.message
  }
}

async function submitCreateBooking(event) {
  event.preventDefault()
  const errorBox = $("#createError")
  const date = $("#createDate").value
  const ids = selectedCreateServiceIds()
  const slot = state.modalSlot
  errorBox.textContent = ""

  if (!date || !ids.length || !slot) {
    errorBox.textContent = "Выберите дату, услуги и свободное время."
    return
  }

  $("#createSubmit").disabled = true
  try {
    const latest = await apiGet("getSlots", { date, serviceIds: ids.join(",") })
    if (!(latest.slots || []).includes(slot)) {
      errorBox.textContent =
        "Это время только что заняли. Список слотов обновлен."
      renderSlotButtons($("#createSlots"), latest.slots || [])
      state.modalSlot = ""
      return
    }

    const result = await adminPost("adminCreateBooking", {
      date,
      time: slot,
      serviceIds: ids.join(","),
      name: $("#createName").value.trim(),
      phone: $("#createPhone").value.trim(),
      comment: $("#createComment").value.trim(),
    })
    if (!result.success)
      throw new Error(result.error || "Не удалось создать запись")
    closeModal()
    await reloadAll()
    showToast("Запись создана в Google Calendar")
  } catch (error) {
    errorBox.textContent = error.message
  } finally {
    $("#createSubmit").disabled = false
  }
}

function openRescheduleModal(id) {
  const item = state.appointments.find((appointment) => appointment.id === id)
  if (!item) return showToast("Запись не найдена")
  state.modalAppointment = item
  state.modalSlot = ""
  $("#modal").innerHTML = `
        <div class="modal-head">
          <div>
            <h3>Перенос записи</h3>
            <p class="muted">${escapeHtml(item.clientName || item.title)} · ${escapeHtml(item.service || "услуга")}</p>
          </div>
          <button class="btn ghost small" type="button" data-close-modal>Закрыть</button>
        </div>
        <form id="rescheduleForm" class="modal-body">
          <div class="grid cols-2">
            <div class="field">
              <label for="rescheduleDate">Новая дата</label>
              <input id="rescheduleDate" type="date" value="${escapeAttr(item.date)}">
            </div>
            <div class="field">
              <label>Длительность</label>
              <input type="text" value="${Number(item.duration || 0)} мин" disabled>
            </div>
          </div>
          <div class="field">
            <label>Свободное время из Google Calendar</label>
            <div id="rescheduleSlots" class="slot-grid"></div>
            <p id="rescheduleMessage" class="muted"></p>
          </div>
          <p id="rescheduleError" class="error"></p>
          <div class="toolbar">
            <button id="rescheduleSubmit" class="btn primary" type="submit">Перенести</button>
            <button class="btn ghost" type="button" data-close-modal>Отмена</button>
          </div>
        </form>
      `
  $("#modalBackdrop").classList.remove("hidden")
  $("#rescheduleForm").addEventListener("submit", submitReschedule)
  $("#rescheduleDate").addEventListener("change", refreshRescheduleSlots)
  $("#rescheduleSlots").addEventListener("click", selectModalSlot)
  refreshRescheduleSlots()
}

async function refreshRescheduleSlots() {
  const item = state.modalAppointment
  const date = $("#rescheduleDate").value
  const slots = $("#rescheduleSlots")
  const message = $("#rescheduleMessage")
  state.modalSlot = ""
  slots.innerHTML = ""
  message.textContent = "Проверяем свободные окна..."
  try {
    const data = await apiGet("getSlots", {
      date,
      duration: item.duration,
      serviceLabel: item.service || item.title,
      ignoreEventId: item.id,
    })
    renderSlotButtons(slots, data.slots || [])
    message.textContent =
      data.slots && data.slots.length
        ? "Можно выбрать только свободное время."
        : "На эту дату нет подходящих слотов."
  } catch (error) {
    message.textContent = error.message
  }
}

async function submitReschedule(event) {
  event.preventDefault()
  const item = state.modalAppointment
  const date = $("#rescheduleDate").value
  const slot = state.modalSlot
  const errorBox = $("#rescheduleError")
  errorBox.textContent = ""
  if (!date || !slot) {
    errorBox.textContent = "Выберите новую дату и время."
    return
  }

  $("#rescheduleSubmit").disabled = true
  try {
    const latest = await apiGet("getSlots", {
      date,
      duration: item.duration,
      serviceLabel: item.service || item.title,
      ignoreEventId: item.id,
    })
    if (!(latest.slots || []).includes(slot)) {
      errorBox.textContent = "Это время уже заняли. Слоты обновлены."
      renderSlotButtons($("#rescheduleSlots"), latest.slots || [])
      state.modalSlot = ""
      return
    }

    const result = await adminPost("rescheduleBooking", {
      id: item.id,
      date,
      time: slot,
    })
    if (!result.success)
      throw new Error(result.error || "Не удалось перенести запись")
    closeModal()
    await reloadAll()
    showToast("Запись перенесена в Google Calendar")
  } catch (error) {
    errorBox.textContent = error.message
  } finally {
    $("#rescheduleSubmit").disabled = false
  }
}

function renderSlotButtons(container, slots) {
  container.innerHTML = slots.length
    ? slots
        .map(
          (slot) => `
        <button class="slot-btn" type="button" data-slot="${escapeAttr(slot)}">${escapeHtml(slot)}</button>
      `,
        )
        .join("")
    : ""
}

function selectModalSlot(event) {
  const button = event.target.closest("[data-slot]")
  if (!button) return
  state.modalSlot = button.dataset.slot
  $$("[data-slot]", button.parentElement).forEach((item) => {
    item.classList.toggle("active", item === button)
  })
}

function selectedCreateServiceIds() {
  return $$(".create-service:checked").map((input) => input.value)
}

async function cancelBooking(id) {
  if (!confirm("Удалить запись? Слот сразу освободится в календаре.")) return
  try {
    const result = await adminPost("cancelBooking", { id })
    if (!result.success)
      throw new Error(result.error || "Не удалось удалить запись")
    await reloadAll()
    showToast("Запись удалена")
  } catch (error) {
    showToast(error.message)
  }
}

async function saveCustomHours() {
  const date = $("#hoursDate").value
  const start = $("#hoursStart").value
  const end = $("#hoursEnd").value
  if (!date || !start || !end) return showToast("Укажите дату и время работы")

  try {
    const result = await adminPost("setCustomHours", {
      date,
      start,
      end,
      breaks: parseBreakLines($("#hoursBreaks").value),
    })
    if (!result.success)
      throw new Error(result.error || "Не удалось сохранить часы")
    await reloadAll()
    showToast("Рабочие часы сохранены")
  } catch (error) {
    showToast(error.message)
  }
}

async function removeCustomHoursByDate() {
  const date = $("#hoursDate").value
  if (!date) return showToast("Выберите дату")
  if (!confirm("Вернуть базовый график для этой даты?")) return
  try {
    const result = await adminPost("removeCustomHours", { date })
    if (!result.success)
      throw new Error(result.error || "Не удалось удалить правило")
    await reloadAll()
    showToast("Базовый график восстановлен")
  } catch (error) {
    showToast(error.message)
  }
}

async function deleteCustomHours(id) {
  if (!confirm("Удалить нестандартный рабочий день?")) return
  try {
    const result = await adminPost("removeCustomHours", { id })
    if (!result.success)
      throw new Error(result.error || "Не удалось удалить правило")
    await reloadAll()
    showToast("Правило удалено")
  } catch (error) {
    showToast(error.message)
  }
}

async function saveBlock() {
  const date = $("#blockDate").value
  const label = $("#blockLabel").value.trim()
  if (!date) return showToast("Выберите дату блокировки")

  try {
    const payload = { date, label }
    const result = $("#blockAllDay").checked
      ? await adminPost("blockDate", payload)
      : await adminPost("blockPeriod", {
          ...payload,
          start: $("#blockStart").value,
          end: $("#blockEnd").value,
        })
    if (!result.success)
      throw new Error(result.error || "Не удалось поставить блок")
    await reloadAll()
    showToast("Блокировка добавлена")
  } catch (error) {
    showToast(error.message)
  }
}

async function deleteBlock(id) {
  if (!confirm("Удалить блокировку?")) return
  try {
    const result = await adminPost("removeBlock", { id })
    if (!result.success)
      throw new Error(result.error || "Не удалось удалить блокировку")
    await reloadAll()
    showToast("Блокировка удалена")
  } catch (error) {
    showToast(error.message)
  }
}

function closeModal() {
  $("#modalBackdrop").classList.add("hidden")
  $("#modal").innerHTML = ""
  state.modalSlot = ""
  state.modalAppointment = null
}

function appointmentsForDate(dateStr) {
  return state.appointments
    .filter((item) => item.date === dateStr)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

function blocksForDate(dateStr) {
  return state.blocks.filter((item) => item.date === dateStr)
}

function getEffectiveHours(dateStr) {
  const custom = state.hours.find((item) => item.date === dateStr)
  if (custom) {
    return { start: custom.start, end: custom.end, breaks: custom.breaks || [] }
  }
  const day = parseIsoDate(dateStr).getDay()
  return DEFAULT_SCHEDULE[day]
}

function calendarTitle() {
  if (state.calendarMode === "month") {
    return state.currentDate.toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
    })
  }
  if (state.calendarMode === "week") {
    const start = startOfWeek(state.currentDate)
    const end = addDays(start, 6)
    return (
      formatDateShort(isoDate(start)) + " - " + formatDateShort(isoDate(end))
    )
  }
  return formatDateLong(isoDate(state.currentDate))
}

function modeLabel(mode) {
  return { day: "день", week: "неделя", month: "месяц" }[mode] || mode
}

function parseBreakLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("-")
      return { start: (parts[0] || "").trim(), end: (parts[1] || "").trim() }
    })
    .filter((item) => item.start && item.end)
}

function setStatus(text) {
  $("#statusText").textContent = text
}

function showToast(message) {
  const toast = $("#toast")
  toast.textContent = message
  toast.classList.remove("hidden")
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3400)
}

function nowTimeString() {
  return new Date().toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date) {
  const copy = startOfDay(date)
  const shift = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - shift)
  return copy
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addDays(date, days) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function addMonths(date, months) {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}

function sameDate(a, b) {
  return isoDate(a) === isoDate(b)
}

function isoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function parseIsoDate(value) {
  const parts = String(value).split("-").map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function formatDateLong(dateStr) {
  const date = parseIsoDate(dateStr)
  return (
    date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear()
  )
}

function formatDateShort(dateStr) {
  const date = parseIsoDate(dateStr)
  return (
    String(date.getDate()).padStart(2, "0") +
    "." +
    String(date.getMonth() + 1).padStart(2, "0") +
    "." +
    date.getFullYear()
  )
}

function timeToMinutes(value) {
  const parts = String(value || "00:00")
    .split(":")
    .map(Number)
  return (parts[0] || 0) * 60 + (parts[1] || 0)
}

function minutesToTime(value) {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0")
}

function encodeId(value) {
  return escapeAttr(encodeURIComponent(String(value || "")))
}

function decodeId(value) {
  return decodeURIComponent(String(value || ""))
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function escapeAttr(value) {
  return escapeHtml(value)
}
