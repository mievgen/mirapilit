// ╔══════════════════════════════════════════════════════════════╗
// ║                  НАСТРОЙКИ ПРОЕКТА                           ║
// ╚══════════════════════════════════════════════════════════════╝

const CALENDAR_NAME = "Салон"
const TIMEZONE = "Europe/Moscow"
const SLOT_STEP_MIN = 15 // Grid interval: every 15 minutes
const HOLD_DURATION_MIN = 10 // Session timeout: 10 minutes
const POST_SERVICE_BUFFER_MIN = 0 // Set > 0 if you need a cleanup buffer after every booking
const BOOKING_LEAD_MIN = 0 // Allow booking from the next available 15-minute slot
const ADMIN_PASSWORD_PROPERTY = "ADMIN_PASSWORD"
const POST_BODY_LIMIT_CHARS = 12000
const HONEYPOT_FIELD = "website"
const MAX_NAME_LEN = 80
const MAX_PHONE_LEN = 32
const MAX_COMMENT_LEN = 500
const MIN_CONFIRM_DELAY_MS = 3000
const HOLD_SLOT_RATE_LIMIT = { limit: 20, windowSec: 600 }
const BOOK_PHONE_RATE_LIMIT = { limit: 3, windowSec: 1800 }
const BOOK_SLOT_RATE_LIMIT = { limit: 6, windowSec: 1800 }

// Системные префиксы (не менять)
const HOLD_PREFIX = "[HOLD]"
const BLOCK_PREFIX = "[ЗАКРЫТО]"
const HOURS_PREFIX = "[ЧАСЫ]"

// ── Услуги: id → { label, duration (мин) } ───────────────────
const SERVICES = {
  // Маникюр
  manicure: { label: "Маникюр", duration: 60 },
  manicure_top: { label: "Маникюр с покрытием", duration: 120 },
  complex_correction: { label: "Сложная коррекция", duration: 150 },
  nail_design: { label: "Дизайн ногтей", duration: 30 },
  extensions: { label: "Наращивание ногтей", duration: 150 },
  correction: { label: "Коррекция ногтей", duration: 120 },
  // Педикюр
  pedicure: { label: "Педикюр", duration: 90 },
  pedicure_hygiene: { label: "Покрытие гигиенический", duration: 90 },
  full_pedicure: { label: "Полный педикюр", duration: 120 },
  // Брови
  brow_shape: { label: "Коррекция бровей", duration: 30 },
  eyebrow_shaping: { label: "Окрашивание бровей", duration: 30 },
  brow_lamination: { label: "Ламинирование бровей", duration: 60 },
  lamination_correction: { label: "Ламинирование + коррекция", duration: 90 },
  // Ресницы
  lash_lamination: { label: "Ламинирование ресниц", duration: 90 },
  // Ваксинг
  waxing: { label: "Ваксинг", duration: 15 },
  // SPA
  spa: { label: "Холодная парафинотерапия", duration: 20 },
}

// ── Базовое расписание (0=Вс…6=Сб, null=выходной) ──────────
// Используется как fallback, если на дату нет кастомных [ЧАСЫ]
// Все изменения — через админ-панель (вкладка «Рабочие часы»)
const DEFAULT_SCHEDULE = {
  0: null, // воскресенье — выходной
  1: { start: "08:00", end: "21:00", breaks: [] },
  2: { start: "08:00", end: "21:00", breaks: [] },
  3: { start: "08:00", end: "21:00", breaks: [] },
  4: { start: "08:00", end: "21:00", breaks: [] },
  5: { start: "08:00", end: "21:00", breaks: [] },
  6: { start: "08:00", end: "21:00", breaks: [] },
}

function getAdminPassword() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD")
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  CORS — обработка preflight OPTIONS-запроса                  ║
// ║  Apps Script не вызывает doOptions автоматически, но         ║
// ║  наличие функции + text/plain Content-Type на фронте         ║
// ║  полностью решает проблему CORS.                             ║
// ╚══════════════════════════════════════════════════════════════╝
function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(
    ContentService.MimeType.TEXT,
  )
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                    МАРШРУТИЗАЦИЯ                             ║
// ╚══════════════════════════════════════════════════════════════╝

function doGet(e) {
  // Guard: при ручном запуске из редактора (кнопка ▶ Run)
  // e === undefined — скрипт завершается с понятным сообщением.
  // Нормальная работа только через URL задеплоенного Web App.
  if (!e || !e.parameter) {
    Logger.log(
      "doGet: вызван без HTTP-контекста (ручной запуск). Используйте URL Web App.",
    )
    return jsonResp({ error: "No HTTP context. Use the deployed Web App URL." })
  }
  try {
    const p = e.parameter
    switch (p.action) {
      case "ping":
        return jsonResp({
          ok: true,
          ts: Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"),
          timezone: TIMEZONE,
        })
      case "getServices":
        return jsonResp(handleGetServices())
      case "getSlots":
        return jsonResp(handleGetSlots(p))
      case "getAvailableDates":
        return jsonResp(handleGetAvailableDates(p))
      case "getSchedule":
        return jsonResp(handleGetSchedule())
      case "getAppointments":
        return jsonResp(adminOnly(p, handleGetAppointments))
      case "getBlocks":
        return jsonResp(adminOnly(p, handleGetBlocks))
      case "getCustomHours":
        return jsonResp(adminOnly(p, handleGetCustomHours))
      default:
        return jsonResp({ error: "Unknown action: " + p.action })
    }
  } catch (err) {
    Logger.log("doGet: " + err.message + "\n" + err.stack)
    return jsonResp({ error: err.message })
  }
}

function doPost(e) {
  // Guard: doPost тоже не работает без HTTP-контекста.
  if (!e || !e.postData) {
    Logger.log("doPost: вызван без HTTP-контекста (ручной запуск).")
    return jsonResp({
      success: false,
      error: "No HTTP context. Use the deployed Web App URL.",
    })
  }
  try {
    const rawBody = String(e.postData.contents || "")
    if (rawBody.length > POST_BODY_LIMIT_CHARS) {
      return jsonResp({ success: false, error: "Request body is too large." })
    }
    const body = JSON.parse(rawBody)

    if (!body || typeof body.action !== "string") {
      return jsonResp({ success: false, error: "Invalid POST payload." })
    }

    switch (body.action) {
      // Публичные
      case "holdSlot":
        return jsonResp(handleHoldSlot(body))
      case "releaseHold":
        return jsonResp(handleReleaseHold(body))
      case "book":
        return jsonResp(handleBook(body))
      // Админские
      case "blockDate":
        return jsonResp(adminOnly(body, handleBlockDate))
      case "blockPeriod":
        return jsonResp(adminOnly(body, handleBlockPeriod))
      case "removeBlock":
        return jsonResp(adminOnly(body, handleRemoveBlock))
      case "cancelBooking":
        return jsonResp(adminOnly(body, handleCancelBooking))
      case "adminCreateBooking":
        return jsonResp(adminOnly(body, handleAdminCreateBooking))
      case "rescheduleBooking":
        return jsonResp(adminOnly(body, handleRescheduleBooking))
      case "setCustomHours":
        return jsonResp(adminOnly(body, handleSetCustomHours))
      case "removeCustomHours":
        return jsonResp(adminOnly(body, handleRemoveCustomHours))
      default:
        return jsonResp({ error: "Unknown action: " + body.action })
    }
  } catch (err) {
    Logger.log("doPost: " + err.message + "\n" + err.stack)
    return jsonResp({ success: false, error: err.message })
  }
}

function adminOnly(params, handler) {
  const configuredPassword = getConfiguredAdminPassword()
  if (!configuredPassword) {
    return {
      error: "ADMIN_PASSWORD is not configured in Script Properties.",
      unauthorized: true,
    }
  }

  if (String(params.password || "") !== configuredPassword) {
    return { error: "Неверный пароль", unauthorized: true }
  }
  return handler(params)
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                  ПУБЛИЧНЫЕ ЭНДПОИНТЫ                         ║
// ╚══════════════════════════════════════════════════════════════╝

function handleGetServices() {
  return { services: SERVICES }
}

function handleGetSchedule() {
  const workDays = []
  for (const key in DEFAULT_SCHEDULE) {
    if (DEFAULT_SCHEDULE[key] !== null) workDays.push(Number(key))
  }
  return { workDays, slotStep: SLOT_STEP_MIN }
}

function handleHoldSlot(body) {
  const { serviceIds, date, time } = body
  if (!serviceIds || !date || !time) {
    return {
      success: false,
      error: "Parameters serviceIds, date and time are required.",
    }
  }

  const selection = resolveServiceSelection(serviceIds)
  if (selection.error) {
    return { success: false, error: selection.error }
  }

  const slotRateKey =
    "hold|" + date + "|" + time + "|" + selection.ids.join(",")
  if (
    isRateLimited(
      slotRateKey,
      HOLD_SLOT_RATE_LIMIT.limit,
      HOLD_SLOT_RATE_LIMIT.windowSec,
    )
  ) {
    return {
      success: false,
      error: "Too many booking attempts. Please wait a few minutes and try again.",
    }
  }

  const bookingWindow = validateBookingWindow(
    date,
    time,
    selection.totalDuration,
  )
  if (bookingWindow.error) {
    return { success: false, error: bookingWindow.error }
  }

  const { startTime, endTime, dayStart, dayEnd } = bookingWindow
  const calendar = getCalendar()

  cleanExpiredHoldsInRange(calendar, dayStart, dayEnd)

  const conflicts = getActiveConflicts(calendar, startTime, endTime)
  if (conflicts.length > 0) {
    return {
      success: false,
      error: "This time is no longer available.",
    }
  }

  const holdCreated = new Date()
  const holdExpires = new Date(
    holdCreated.getTime() + HOLD_DURATION_MIN * 60000,
  )
  const holdEvent = calendar.createEvent(
    HOLD_PREFIX + " " + selection.serviceLabel,
    startTime,
    endTime,
    {
      description: buildHoldDescription(
        selection.serviceLabel,
        selection.serviceDuration,
        selection.totalDuration,
        holdExpires,
        holdCreated,
      ),
    },
  )

  return {
    success: true,
    holdId: holdEvent.getId(),
    expiresAt: holdExpires.getTime(),
  }
}

function handleReleaseHold(body) {
  if (!body.holdId) {
    return { success: false, error: "holdId is required." }
  }

  try {
    const holdEvent = getCalendar().getEventById(body.holdId)
    if (!holdEvent) {
      return { success: true }
    }
    if (!holdEvent.getTitle().startsWith(HOLD_PREFIX)) {
      return { success: false, error: "This event is not a temporary hold." }
    }

    holdEvent.deleteEvent()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function handleBook(body) {
  const rawName = String(body.name || "")
  const rawPhone = String(body.phone || "")
  const rawComment = String(body.comment || "")
  const honeypotValue = String(body[HONEYPOT_FIELD] || "")

  if (
    honeypotValue.trim() ||
    hasSuspiciousText(rawName) ||
    hasSuspiciousText(rawComment)
  ) {
    return { success: false, error: "Spam protection triggered." }
  }

  const name = normalizeClientText(rawName, MAX_NAME_LEN)
  const phone = normalizePhone(rawPhone)
  const comment = normalizeClientText(rawComment, MAX_COMMENT_LEN)

  if (!body.serviceIds || !body.date || !body.time || !name || !phone) {
    return {
      success: false,
      error: "Name, phone, services, date and time are required.",
    }
  }

  if (name.length < 2) {
    return { success: false, error: "Please enter a valid name." }
  }

  if (!isPhoneAllowed(phone)) {
    return { success: false, error: "Please enter a valid phone number." }
  }

  const selection = resolveServiceSelection(body.serviceIds)
  if (selection.error) {
    return { success: false, error: selection.error }
  }

  const slotRateKey =
    "book-slot|" +
    body.date +
    "|" +
    body.time +
    "|" +
    selection.ids.join(",")
  if (
    isRateLimited(
      "book-phone|" + phone,
      BOOK_PHONE_RATE_LIMIT.limit,
      BOOK_PHONE_RATE_LIMIT.windowSec,
    ) ||
    isRateLimited(
      slotRateKey,
      BOOK_SLOT_RATE_LIMIT.limit,
      BOOK_SLOT_RATE_LIMIT.windowSec,
    )
  ) {
    return {
      success: false,
      error: "Too many booking attempts. Please wait a little and try again.",
    }
  }

  const bookingWindow = validateBookingWindow(
    body.date,
    body.time,
    selection.totalDuration,
  )
  if (bookingWindow.error) {
    return { success: false, error: bookingWindow.error }
  }

  const { startTime, endTime, dayStart, dayEnd } = bookingWindow
  const calendar = getCalendar()

  cleanExpiredHoldsInRange(calendar, dayStart, dayEnd)

  const holdEvent = getMatchingHoldEvent(
    calendar,
    body.holdId,
    startTime,
    endTime,
  )
  if (!holdEvent) {
    return {
      success: false,
      error: "The temporary hold has expired. Please choose the slot again.",
    }
  }

  if (Date.now() - getHoldCreatedTs(holdEvent) < MIN_CONFIRM_DELAY_MS) {
    return {
      success: false,
      error: "Please wait a few seconds before confirming the booking.",
    }
  }

  const conflicts = getActiveConflicts(
    calendar,
    startTime,
    endTime,
    holdEvent.getId(),
  )
  if (conflicts.length > 0) {
    return {
      success: false,
      error: "This time is no longer available.",
    }
  }

  try {
    const eventTitle = buildBookingTitle(name, selection.serviceLabel)
    const description = buildBookingDescription(
      name,
      phone,
      selection.serviceLabel,
      selection.serviceDuration,
      selection.totalDuration,
      endTime,
      comment,
    )
    const bookingEvent = saveBookingEvent(
      calendar,
      holdEvent,
      eventTitle,
      startTime,
      endTime,
      description,
    )

    return {
      success: true,
      eventId: bookingEvent.getId(),
      title: eventTitle,
      start: Utilities.formatDate(startTime, TIMEZONE, "dd.MM.yyyy HH:mm"),
      end: Utilities.formatDate(endTime, TIMEZONE, "HH:mm"),
    }
  } catch (err) {
    Logger.log("handleBook: " + err.message + "\n" + err.stack)
    return {
      success: false,
      error: "Failed to create booking in Google Calendar.",
    }
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║   ГЕНЕРАЦИЯ СЛОТОВ — логика как в Yclients / Booksy          ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  Правило: слот показывается ТОЛЬКО если выполнены ВСЕ три   ║
// ║  условия одновременно:                                       ║
// ║  1. Услуга целиком помещается до конца рабочего дня          ║
// ║     (start + duration ≤ dayEnd)                              ║
// ║  2. Весь отрезок [start, start+duration] не пересекается     ║
// ║     ни с одним занятым событием из календаря                 ║
// ║  3. Весь отрезок [start, start+duration] не пересекается     ║
// ║     ни с одним перерывом из расписания                       ║
// ╚══════════════════════════════════════════════════════════════╝

function handleGetSlots(params) {
  const { date, serviceIds, duration, ignoreEventId, serviceLabel } = params
  if (!date || (!serviceIds && !duration)) {
    return { error: "Parameters date and serviceIds/duration are required" }
  }

  const selection = serviceIds
    ? resolveServiceSelection(serviceIds)
    : resolveDurationSelection(duration, serviceLabel)
  if (selection.error) {
    return { error: selection.error }
  }

  return getDayAvailability(date, selection, null, {
    ignoredEventId: ignoreEventId || null,
  })
}

function handleGetAvailableDates(params) {
  const year = Number(params.year)
  const month = Number(params.month)
  const { serviceIds, duration, ignoreEventId, serviceLabel } = params

  if (!year || !month || month < 1 || month > 12 || (!serviceIds && !duration)) {
    return { error: "Parameters year, month and serviceIds/duration are required" }
  }

  const selection = serviceIds
    ? resolveServiceSelection(serviceIds)
    : resolveDurationSelection(duration, serviceLabel)
  if (selection.error) {
    return { error: selection.error }
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const todayStr = formatDate(new Date())
  const availableDates = []
  const calendar = getCalendar()

  for (let day = 1; day <= daysInMonth; day++) {
    const date = formatDateParts(year, month, day)
    if (date < todayStr) continue

    const availability = getDayAvailability(date, selection, calendar, {
      ignoredEventId: ignoreEventId || null,
    })
    if (availability.slots && availability.slots.length) {
      availableDates.push(date)
    }
  }

  return { availableDates }
}

// ??????????????????????????????????????????????????????????????
// isSlotFree ? ?????? ?????????
//
// ?????????: ?? ???????????? ?? ??????? [slotStart, slotEnd]
// ?? ? ????? ?????????? ?? busyIntervals.
//
// ??? ??????? A ? B ???????????? ????? ? ?????? ?????, ?????:
//   A.start < B.end  AND  A.end > B.start
//
// ??????? (?????? 60 ???, ??????? 14:00?15:00):
//   13:00?14:00  ? end(14:00) ?? > start(14:00) ? ?? ???????????? ?
//   13:30?14:30  ? 13:30 < 15:00 AND 14:30 > 14:00 ? ???????????? ?
//   14:00?15:00  ? IS the break ? ???????????? ?
//   14:30?15:30  ? 14:30 < 15:00 AND 15:30 > 14:00 ? ???????????? ?
//   15:00?16:00  ? 15:00 < 15:00? NO ? ?? ???????????? ?
// ??????????????????????????????????????????????????????????????
function isSlotFree(slotStartMs, slotEndMs, busyIntervals) {
  for (var i = 0; i < busyIntervals.length; i++) {
    var b = busyIntervals[i]
    if (slotStartMs < b.end && slotEndMs > b.start) {
      return false // пересечение найдено — слот недоступен
    }
  }
  return true // пересечений нет — слот свободен
}

function resolveServiceSelection(serviceIds) {
  const ids = String(serviceIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (!ids.length) {
    return { error: "No services selected" }
  }

  const unknownIds = ids.filter((id) => !SERVICES[id])
  if (unknownIds.length) {
    return { error: "Unknown services: " + unknownIds.join(", ") }
  }

  const serviceDuration = ids.reduce((sum, id) => sum + SERVICES[id].duration, 0)
  return {
    ids,
    serviceDuration,
    totalDuration: serviceDuration + POST_SERVICE_BUFFER_MIN,
    serviceLabel: ids.map((id) => SERVICES[id].label || id).join(" + "),
  }
}

function resolveDurationSelection(duration, serviceLabel) {
  const totalDuration = Number(duration)
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    return { error: "Invalid visit duration" }
  }

  return {
    ids: [],
    serviceDuration: Math.max(0, totalDuration - POST_SERVICE_BUFFER_MIN),
    totalDuration,
    serviceLabel: serviceLabel || "Visit",
  }
}

function getDayAvailability(date, selection, calendar, options) {
  const cal = calendar || getCalendar()
  const dayHours = getDayHours(date, cal)
  if (!dayHours) {
    return { slots: [], reason: "day_off", message: "Выходной день" }
  }

  const dayStart = buildDateTime(date, dayHours.start)
  const dayEnd = buildDateTime(date, dayHours.end)
  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()

  cleanExpiredHoldsInRange(cal, dayStart, dayEnd)

  const busyIntervals = mergeBusyIntervals(
    buildBusyIntervals(
      getCalendarEventsInWindow(cal, dayStart, dayEnd),
      options && options.ignoredEventId,
      dayStartMs,
      dayEndMs,
    ).concat(buildBreakBusyIntervals(date, dayHours.breaks)),
  )
  const stepMs = SLOT_STEP_MIN * 60000
  const earliestStartMs = getEarliestBookableStartMs(date, dayStartMs, stepMs)
  const slots = buildSlotsFromAvailability(
    busyIntervals,
    dayStartMs,
    dayEndMs,
    selection.totalDuration * 60000,
    stepMs,
    earliestStartMs,
  )

  if (!slots.length) {
    return {
      slots: [],
      reason: "no_free_slots",
      message: "Нет свободного времени для выбранных услуг",
    }
  }

  return {
    slots,
    serviceDuration: selection.serviceDuration,
    totalDuration: selection.totalDuration,
    postServiceBuffer: POST_SERVICE_BUFFER_MIN,
    dayStart: dayHours.start,
    dayEnd: dayHours.end,
  }
}

function buildBusyIntervals(events, ignoredEventId, clampStartMs, clampEndMs) {
  return events
    .filter(
      (ev) =>
        ev.getId() !== ignoredEventId && !ev.getTitle().startsWith(HOURS_PREFIX),
    )
    .map((ev) => ({
      start:
        clampStartMs == null
          ? ev.getStartTime().getTime()
          : Math.max(ev.getStartTime().getTime(), clampStartMs),
      end:
        clampEndMs == null
          ? ev.getEndTime().getTime()
          : Math.min(ev.getEndTime().getTime(), clampEndMs),
    }))
    .filter((interval) => interval.start < interval.end)
}

function buildBreakBusyIntervals(date, breaks) {
  return (breaks || [])
    .map((br) => ({
      start: buildDateTime(date, br.start).getTime(),
      end: buildDateTime(date, br.end).getTime(),
    }))
    .filter((br) => br.start < br.end)
}

function mergeBusyIntervals(intervals) {
  if (!intervals.length) return []

  const sorted = intervals
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
      continue
    }

    merged.push({ start: current.start, end: current.end })
  }

  return merged
}

function alignToSlotGrid(timestampMs, gridStartMs, stepMs) {
  if (timestampMs <= gridStartMs) return gridStartMs

  const offset = timestampMs - gridStartMs
  return gridStartMs + Math.ceil(offset / stepMs) * stepMs
}

function pushWindowSlots(
  slots,
  freeStartMs,
  freeEndMs,
  durationMs,
  stepMs,
  gridStartMs,
  earliestStartMs,
) {
  let cursor = alignToSlotGrid(
    Math.max(freeStartMs, earliestStartMs),
    gridStartMs,
    stepMs,
  )

  while (cursor + durationMs <= freeEndMs) {
    slots.push(Utilities.formatDate(new Date(cursor), TIMEZONE, "HH:mm"))
    cursor += stepMs
  }
}

function buildSlotsFromAvailability(
  busyIntervals,
  dayStartMs,
  dayEndMs,
  durationMs,
  stepMs,
  earliestStartMs,
) {
  const slots = []
  let freeStartMs = dayStartMs

  for (let i = 0; i < busyIntervals.length; i++) {
    const busy = busyIntervals[i]
    if (busy.start > freeStartMs) {
      pushWindowSlots(
        slots,
        freeStartMs,
        busy.start,
        durationMs,
        stepMs,
        dayStartMs,
        earliestStartMs,
      )
    }
    freeStartMs = Math.max(freeStartMs, busy.end)
  }

  if (freeStartMs < dayEndMs) {
    pushWindowSlots(
      slots,
      freeStartMs,
      dayEndMs,
      durationMs,
      stepMs,
      dayStartMs,
      earliestStartMs,
    )
  }

  return slots
}

function getEarliestBookableStartMs(date, dayStartMs, stepMs) {
  if (date !== formatDate(new Date())) return dayStartMs

  return alignToSlotGrid(
    Math.max(dayStartMs, Date.now() + BOOKING_LEAD_MIN * 60000 + 1000),
    dayStartMs,
    stepMs,
  )
}

function validateBookingWindow(date, time, totalDuration) {
  const dayHours = getDayHours(date)
  if (!dayHours) {
    return { error: "На этот день запись недоступна." }
  }

  const startTime = buildDateTime(date, time)
  const endTime = new Date(startTime.getTime() + totalDuration * 60000)
  const dayStart = buildDateTime(date, dayHours.start)
  const dayEnd = buildDateTime(date, dayHours.end)
  const stepMs = SLOT_STEP_MIN * 60000
  const earliestStartMs = getEarliestBookableStartMs(date, dayStart.getTime(), stepMs)

  if (startTime.getTime() < earliestStartMs) {
    return { error: "Это время уже недоступно. Выберите более поздний слот." }
  }

  if (
    alignToSlotGrid(startTime.getTime(), dayStart.getTime(), stepMs) !==
    startTime.getTime()
  ) {
    return { error: "Выбранное время не соответствует шагу записи." }
  }

  if (
    startTime.getTime() < dayStart.getTime() ||
    endTime.getTime() > dayEnd.getTime()
  ) {
    return { error: "Выбранное время выходит за рамки рабочих часов." }
  }

  const breakBusy = buildBreakBusyIntervals(date, dayHours.breaks)
  if (!isSlotFree(startTime.getTime(), endTime.getTime(), breakBusy)) {
    return { error: "Выбранное время пересекается с техническим перерывом." }
  }

  return { dayHours, dayStart, dayEnd, startTime, endTime }
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB
}

function getCalendarEventsInWindow(calendar, windowStart, windowEnd) {
  const dayMs = 24 * 60 * 60 * 1000
  const startMs = windowStart.getTime()
  const endMs = windowEnd.getTime()
  const scanStart = new Date(startMs - dayMs)
  const scanEnd = new Date(endMs + dayMs)

  return calendar.getEvents(scanStart, scanEnd).filter((ev) =>
    intervalsOverlap(
      startMs,
      endMs,
      ev.getStartTime().getTime(),
      ev.getEndTime().getTime(),
    ),
  )
}

function getActiveConflicts(calendar, startTime, endTime, ignoredEventId) {
  return getCalendarEventsInWindow(calendar, startTime, endTime).filter((ev) => {
    if (ev.getId() === ignoredEventId) return false
    if (ev.getTitle().startsWith(HOURS_PREFIX)) return false
    return true
  })
}

function getMatchingHoldEvent(calendar, holdId, startTime, endTime) {
  if (!holdId) return null
  try {
    const holdEvent = calendar.getEventById(holdId)
    if (!holdEvent || !holdEvent.getTitle().startsWith(HOLD_PREFIX)) return null
    if (getHoldExpiryTs(holdEvent) <= Date.now()) return null
    if (
      holdEvent.getStartTime().getTime() !== startTime.getTime() ||
      holdEvent.getEndTime().getTime() !== endTime.getTime()
    ) {
      return null
    }
    return holdEvent
  } catch (e) {
    return null
  }
}

function buildHoldDescription(
  serviceLabel,
  serviceDuration,
  totalDuration,
  holdExpires,
  holdCreated,
) {
  return [
    "Статус: удержание слота",
    "💅 Услуги: " + serviceLabel,
    "⏱ Длительность услуг: " + serviceDuration + " мин",
    "🧹 Буфер после услуги: " + POST_SERVICE_BUFFER_MIN + " мин",
    "🕒 Занято в календаре: " + totalDuration + " мин",
    "holdCreatedTs=" + holdCreated.getTime(),
    "Держать до: " + Utilities.formatDate(holdExpires, TIMEZONE, "dd.MM.yyyy HH:mm"),
    "holdUntilTs=" + holdExpires.getTime(),
  ].join("\n")
}

function buildBookingTitle(name, serviceLabel) {
  return name + " / " + serviceLabel
}

function buildBookingDescription(
  name,
  phone,
  serviceLabel,
  serviceDuration,
  totalDuration,
  endTime,
  comment,
) {
  const endFmt = Utilities.formatDate(endTime, TIMEZONE, "HH:mm")
  const bookedAt = Utilities.formatDate(new Date(), TIMEZONE, "dd.MM.yyyy HH:mm")

  return [
    "👤 Клиент: " + name,
    "📞 Телефон: " + phone,
    "💅 Услуги: " + serviceLabel,
    "⏱ Длительность услуг: " + serviceDuration + " мин",
    "🧹 Буфер после услуги: " + POST_SERVICE_BUFFER_MIN + " мин",
    "🕒 Занято в календаре: " + totalDuration + " мин (до " + endFmt + ")",
    comment ? "💬 Комментарий: " + comment : "",
    "",
    "🗓 Запись создана: " + bookedAt,
  ]
    .filter(Boolean)
    .join("\n")
}

function appendAuditTrail(description, line) {
  return [description || "", line ? "" : "", line || ""].filter(Boolean).join("\n")
}

function saveBookingEvent(calendar, holdEvent, title, startTime, endTime, description) {
  if (holdEvent) {
    holdEvent.setTitle(title)
    holdEvent.setDescription(description)
    holdEvent.setTime(startTime, endTime)
    return holdEvent
  }

  return calendar.createEvent(title, startTime, endTime, { description })
}

function normalizeClientText(value, maxLen) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/[^\d+]/g, "")
    .replace(/^8(?=\d{10}$)/, "7")
    .slice(0, MAX_PHONE_LEN)
}

function isPhoneAllowed(phone) {
  const digits = String(phone || "").replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 15
}

function hasSuspiciousText(value) {
  return /https?:\/\/|www\.|<[^>]+>|script|data:/i.test(String(value || ""))
}

function isRateLimited(rawKey, limit, windowSec) {
  const cache = CacheService.getScriptCache()
  const lock = LockService.getScriptLock()
  const key = "rl|" + hashKey(rawKey)
  const now = Date.now()
  const defaultState = {
    count: 0,
    resetAt: now + windowSec * 1000,
  }

  try {
    lock.waitLock(3000)
    const cached = cache.get(key)
    const state = cached ? JSON.parse(cached) : defaultState
    if (!state.resetAt || state.resetAt <= now) {
      state.count = 0
      state.resetAt = now + windowSec * 1000
    }
    state.count += 1
    cache.put(
      key,
      JSON.stringify(state),
      Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
    )
    return state.count > limit
  } catch (e) {
    Logger.log("isRateLimited fallback: " + e.message)
    return false
  } finally {
    try {
      lock.releaseLock()
    } catch (ignored) {}
  }
}

function hashKey(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
  )
    .map(function (b) {
      const n = b < 0 ? b + 256 : b
      return ("0" + n.toString(16)).slice(-2)
    })
    .join("")
}

// ──────────────────────────────────────────────────────────────
// Возвращает рабочие часы на дату: сначала ищет [ЧАСЫ] событие,
// иначе берёт DEFAULT_SCHEDULE
// ──────────────────────────────────────────────────────────────
function getDayHours(date, calendar) {
  const cal = calendar || getCalendar()
  const midnight = buildDateTime(date, "00:00")
  const eod = buildDateTime(date, "23:59")

  const events = cal.getEvents(midnight, eod)
  for (const ev of events) {
    if (ev.getTitle().startsWith(HOURS_PREFIX)) {
      const desc = ev.getDescription() || ""
      const startM = desc.match(/start=(\d{2}:\d{2})/)
      const endM = desc.match(/end=(\d{2}:\d{2})/)
      if (startM && endM) {
        const breaksM = desc.match(/breaks=([^;]*)/)
        const breaks = []
        if (breaksM && breaksM[1]) {
          breaksM[1].split("|").forEach((b) => {
            const p = b.split("-")
            if (p.length === 2) breaks.push({ start: p[0], end: p[1] })
          })
        }
        return { start: startM[1], end: endM[1], breaks, custom: true }
      }
    }
  }

  const dayOfWeek = getWeekdayIndex(buildDateTime(date, "12:00"))
  return DEFAULT_SCHEDULE[dayOfWeek] || null
}

function handleGetAppointments(params) {
  const calendar = getCalendar()
  const from = params.from
    ? buildDateTime(params.from, "00:00")
    : new Date()
  const to = params.to
    ? buildDateTime(params.to, "23:59")
    : new Date(from.getTime() + 90 * 24 * 3600000)
  const events = calendar.getEvents(from, to)

  const list = []
  events.forEach((ev) => {
    const title = ev.getTitle()
    if (
      title.startsWith(HOLD_PREFIX) ||
      title.startsWith(BLOCK_PREFIX) ||
      title.startsWith(HOURS_PREFIX)
    ) {
      return
    }

    const start = ev.getStartTime()
    const end = ev.getEndTime()
    const desc = ev.getDescription() || ""
    const lines = desc
      .replaceAll(String.fromCharCode(13), "")
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
    const phone = lines[1] ? lines[1].split(":").slice(1).join(":").trim() : ""
    const svc = lines[2] ? lines[2].split(":").slice(1).join(":").trim() : ""
    const clientName = title.includes(" / ") ? title.split(" / ")[0] : title

    list.push({
      id: ev.getId(),
      title,
      clientName,
      service: svc,
      phone,
      date: Utilities.formatDate(start, TIMEZONE, "yyyy-MM-dd"),
      dateFmt: Utilities.formatDate(start, TIMEZONE, "dd.MM.yyyy"),
      weekday: getWeekdayRu(getWeekdayIndex(start)),
      startTime: Utilities.formatDate(start, TIMEZONE, "HH:mm"),
      endTime: Utilities.formatDate(end, TIMEZONE, "HH:mm"),
      duration: Math.round((end - start) / 60000),
      startTs: start.getTime(),
      endTs: end.getTime(),
      comment: "",
      description: desc,
    })
  })

  list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
  )
  return { appointments: list }
}

function handleGetBlocks(params) {
  const calendar = getCalendar()
  const now = new Date()
  const future = new Date(now.getTime() + 365 * 24 * 3600000)
  const blocks = []

  calendar.getEvents(now, future).forEach((ev) => {
    if (!ev.getTitle().startsWith(BLOCK_PREFIX)) return
    const start = ev.getStartTime()
    const end = ev.getEndTime()
    blocks.push({
      id: ev.getId(),
      title: ev.getTitle(),
      label: ev.getDescription() || "",
      date: Utilities.formatDate(start, TIMEZONE, "yyyy-MM-dd"),
      dateFmt: Utilities.formatDate(start, TIMEZONE, "dd.MM.yyyy"),
      weekday: getWeekdayRu(getWeekdayIndex(start)),
      start: Utilities.formatDate(start, TIMEZONE, "HH:mm"),
      end: Utilities.formatDate(end, TIMEZONE, "HH:mm"),
      fullDay: end - start >= 23 * 3600000,
    })
  })

  blocks.sort((a, b) => a.date.localeCompare(b.date))
  return { blocks }
}

function handleGetCustomHours(params) {
  const calendar = getCalendar()
  const from = params.from
    ? buildDateTime(params.from, "00:00")
    : buildDateTime(formatDate(new Date()), "00:00")
  const to = params.to
    ? buildDateTime(params.to, "23:59")
    : new Date(from.getTime() + 365 * 24 * 3600000)
  const hours = []

  calendar.getEvents(from, to).forEach((ev) => {
    if (!ev.getTitle().startsWith(HOURS_PREFIX)) return
    const parsed = parseCustomHoursEvent(ev)
    if (parsed) hours.push(parsed)
  })

  hours.sort((a, b) => a.date.localeCompare(b.date))
  return { hours }
}

function handleSetCustomHours(body) {
  const { date, start, end } = body
  if (!date || !start || !end) {
    return { success: false, error: "Укажите дату и рабочее время" }
  }
  if (end <= start) {
    return { success: false, error: "Время конца должно быть позже начала" }
  }

  const breaks = normalizeCustomBreaks(body.breaks)
  for (const br of breaks) {
    if (br.end <= br.start) {
      return { success: false, error: "Перерыв должен заканчиваться позже начала" }
    }
    if (br.start < start || br.end > end) {
      return { success: false, error: "Перерыв должен быть внутри рабочего дня" }
    }
  }

  const calendar = getCalendar()
  removeCustomHoursForDate(calendar, date)

  const description = [
    "start=" + start,
    "end=" + end,
    "breaks=" + breaks.map((br) => br.start + "-" + br.end).join("|"),
  ].join(";")

  const ev = calendar.createEvent(
    HOURS_PREFIX + " " + formatDateRu(date),
    buildDateTime(date, "00:00"),
    buildDateTime(date, "00:05"),
    { description },
  )

  return { success: true, id: ev.getId(), hours: parseCustomHoursEvent(ev) }
}

function handleRemoveCustomHours(body) {
  if (!body.id && !body.date) {
    return { success: false, error: "Укажите ID правила или дату" }
  }

  try {
    const calendar = getCalendar()
    if (body.id) {
      const ev = calendar.getEventById(body.id)
      if (!ev) return { success: false, error: "Правило не найдено" }
      if (!ev.getTitle().startsWith(HOURS_PREFIX)) {
        return { success: false, error: "Это не правило рабочих часов" }
      }
      ev.deleteEvent()
      return { success: true }
    }

    removeCustomHoursForDate(calendar, body.date)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function parseCustomHoursEvent(ev) {
  const desc = ev.getDescription() || ""
  const startM = desc.match(/start=(\d{2}:\d{2})/)
  const endM = desc.match(/end=(\d{2}:\d{2})/)
  if (!startM || !endM) return null

  const date = Utilities.formatDate(ev.getStartTime(), TIMEZONE, "yyyy-MM-dd")
  const breaksM = desc.match(/breaks=([^;]*)/)
  return {
    id: ev.getId(),
    title: ev.getTitle(),
    date,
    dateFmt: Utilities.formatDate(ev.getStartTime(), TIMEZONE, "dd.MM.yyyy"),
    weekday: getWeekdayRu(getWeekdayIndex(ev.getStartTime())),
    start: startM[1],
    end: endM[1],
    breaks: normalizeCustomBreaks(breaksM ? breaksM[1] : ""),
  }
}

function normalizeCustomBreaks(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((br) => ({
        start: String(br.start || "").trim(),
        end: String(br.end || "").trim(),
      }))
      .filter((br) => isTimeString(br.start) && isTimeString(br.end))
  }

  return String(value)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split("-")
      return {
        start: String(pieces[0] || "").trim(),
        end: String(pieces[1] || "").trim(),
      }
    })
    .filter((br) => isTimeString(br.start) && isTimeString(br.end))
}

function removeCustomHoursForDate(calendar, date) {
  const dayStart = buildDateTime(date, "00:00")
  const dayEnd = buildDateTime(date, "23:59")
  calendar.getEvents(dayStart, dayEnd).forEach((ev) => {
    if (ev.getTitle().startsWith(HOURS_PREFIX)) ev.deleteEvent()
  })
}

function isTimeString(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))
}

function handleBlockDate(body) {
  const { date, label } = body
  if (!date) return { success: false, error: "Укажите дату" }

  const calendar = getCalendar()
  const dayStart = buildDateTime(date, "00:00")
  const dayEnd = buildDateTime(date, "23:59")

  const existing = calendar
    .getEvents(dayStart, dayEnd)
    .some(
      (ev) =>
        ev.getTitle().startsWith(BLOCK_PREFIX) && ev.getStartTime() <= dayStart,
    )
  if (existing)
    return { success: false, error: "На этот день уже стоит блокировка." }

  const ev = calendar.createEvent(
    BLOCK_PREFIX + " " + formatDateRu(date),
    dayStart,
    dayEnd,
    { description: label || "День закрыт" },
  )
  return { success: true, id: ev.getId() }
}

function handleBlockPeriod(body) {
  const { date, start, end, label } = body
  if (!date || !start || !end)
    return { success: false, error: "Укажите дату и время" }
  if (end <= start)
    return { success: false, error: "Время конца должно быть позже начала" }

  const ev = getCalendar().createEvent(
    BLOCK_PREFIX + " " + start + "–" + end,
    buildDateTime(date, start),
    buildDateTime(date, end),
    { description: label || "Занято" },
  )
  return { success: true, id: ev.getId() }
}

function handleRemoveBlock(body) {
  if (!body.id) return { success: false, error: "ID не указан" }
  try {
    const ev = getCalendar().getEventById(body.id)
    if (!ev) return { success: false, error: "Не найдено" }
    if (!ev.getTitle().startsWith(BLOCK_PREFIX))
      return { success: false, error: "Это не блокировка" }
    ev.deleteEvent()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function handleCancelBooking(body) {
  if (!body.id) return { success: false, error: "ID is required" }
  try {
    const ev = getCalendar().getEventById(body.id)
    if (!ev) return { success: false, error: "Booking not found" }
    const t = ev.getTitle()
    if (
      t.startsWith(HOLD_PREFIX) ||
      t.startsWith(BLOCK_PREFIX) ||
      t.startsWith(HOURS_PREFIX)
    ) {
      return { success: false, error: "Only client bookings can be cancelled" }
    }
    ev.deleteEvent()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function handleAdminCreateBooking(body) {
  const { serviceIds, date, time, name, phone, comment } = body
  if (!serviceIds || !date || !time || !name || !phone) {
    return {
      success: false,
      error: "Name, phone, services, date and time are required.",
    }
  }

  const selection = resolveServiceSelection(serviceIds)
  if (selection.error) return { success: false, error: selection.error }

  const bookingWindow = validateBookingWindow(
    date,
    time,
    selection.totalDuration,
  )
  if (bookingWindow.error) {
    return { success: false, error: bookingWindow.error }
  }

  const { startTime, endTime, dayStart, dayEnd } = bookingWindow
  const calendar = getCalendar()

  cleanExpiredHoldsInRange(calendar, dayStart, dayEnd)

  const conflicts = getActiveConflicts(calendar, startTime, endTime)
  if (conflicts.length > 0) {
    return {
      success: false,
      error: "This time is no longer available.",
    }
  }

  try {
    const eventTitle = buildBookingTitle(name, selection.serviceLabel)
    const description = appendAuditTrail(
      buildBookingDescription(
        name,
        phone,
        selection.serviceLabel,
        selection.serviceDuration,
        selection.totalDuration,
        endTime,
        comment,
      ),
      "Admin created: " +
        Utilities.formatDate(new Date(), TIMEZONE, "dd.MM.yyyy HH:mm"),
    )

    const bookingEvent = saveBookingEvent(
      calendar,
      null,
      eventTitle,
      startTime,
      endTime,
      description,
    )

    return {
      success: true,
      eventId: bookingEvent.getId(),
      title: eventTitle,
      start: Utilities.formatDate(startTime, TIMEZONE, "dd.MM.yyyy HH:mm"),
      end: Utilities.formatDate(endTime, TIMEZONE, "HH:mm"),
    }
  } catch (err) {
    Logger.log("handleAdminCreateBooking: " + err.message + "\n" + err.stack)
    return {
      success: false,
      error: "Failed to create booking in Google Calendar.",
    }
  }
}

function handleRescheduleBooking(body) {
  const { id, date, time } = body
  if (!id || !date || !time) {
    return {
      success: false,
      error: "Booking id, date and time are required.",
    }
  }

  try {
    const calendar = getCalendar()
    const event = calendar.getEventById(id)
    if (!event) {
      return { success: false, error: "Booking not found." }
    }

    const title = event.getTitle()
    if (
      title.startsWith(HOLD_PREFIX) ||
      title.startsWith(BLOCK_PREFIX) ||
      title.startsWith(HOURS_PREFIX)
    ) {
      return { success: false, error: "This event cannot be rescheduled." }
    }

    const totalDuration = Math.round(
      (event.getEndTime().getTime() - event.getStartTime().getTime()) / 60000,
    )
    if (!totalDuration) {
      return { success: false, error: "Could not determine booking duration." }
    }

    const bookingWindow = validateBookingWindow(date, time, totalDuration)
    if (bookingWindow.error) {
      return { success: false, error: bookingWindow.error }
    }

    const { startTime, endTime, dayStart, dayEnd } = bookingWindow
    cleanExpiredHoldsInRange(calendar, dayStart, dayEnd)

    const conflicts = getActiveConflicts(calendar, startTime, endTime, id)
    if (conflicts.length > 0) {
      return {
        success: false,
        error: "The selected new time is no longer available.",
      }
    }

    event.setTime(startTime, endTime)
    event.setDescription(
      appendAuditTrail(
        event.getDescription() || "",
        "Admin rescheduled: " +
          Utilities.formatDate(new Date(), TIMEZONE, "dd.MM.yyyy HH:mm"),
      ),
    )

    return {
      success: true,
      eventId: event.getId(),
      start: Utilities.formatDate(startTime, TIMEZONE, "dd.MM.yyyy HH:mm"),
      end: Utilities.formatDate(endTime, TIMEZONE, "HH:mm"),
    }
  } catch (e) {
    Logger.log("handleRescheduleBooking: " + e.message + "\n" + e.stack)
    return {
      success: false,
      error: "Failed to reschedule booking in Google Calendar.",
    }
  }
}

function cleanExpiredHoldsInRange(calendar, from, to) {
  const now = Date.now()
  try {
    calendar.getEvents(from, to).forEach((ev) => {
      if (isExpiredHoldEvent(ev, now)) ev.deleteEvent()
    })
  } catch (e) {}
}

// Запускать триггером каждые 30 минут
function cleanAllExpiredHolds() {
  const cal = getCalendar()
  const now = Date.now()
  const from = new Date(now - 24 * 3600000)
  const to = new Date(now + 90 * 24 * 3600000)
  cal.getEvents(from, to).forEach((ev) => {
    if (isExpiredHoldEvent(ev, now)) ev.deleteEvent()
  })
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                      УТИЛИТЫ                                 ║
// ╚══════════════════════════════════════════════════════════════╝

function getCalendar() {
  // No module-level cache — Apps Script can persist stale references
  // across hot-reload executions, causing silent calendar failures.
  const list = CalendarApp.getCalendarsByName(CALENDAR_NAME)
  if (!list.length) {
    throw new Error(
      'Календарь "' +
        CALENDAR_NAME +
        '" не найден. ' +
        "Проверьте: 1) имя в настройках скрипта, " +
        "2) скрипт запускается от имени владельца календаря, " +
        '3) развёртывание "Выполнять как: Я".',
    )
  }
  return list[0]
}

function buildDateTime(dateStr, timeStr) {
  const d = dateStr.split("-").map(Number)
  const t = timeStr.split(":").map(Number)
  return buildZonedDateTime(d[0], d[1], d[2], t[0], t[1])
}

function buildZonedDateTime(year, month, day, hour, minute) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  let offsetMs = getTimeZoneOffsetMs(utcGuess, TIMEZONE)
  let zonedDate = new Date(utcGuess.getTime() - offsetMs)

  const correctedOffsetMs = getTimeZoneOffsetMs(zonedDate, TIMEZONE)
  if (correctedOffsetMs !== offsetMs) {
    offsetMs = correctedOffsetMs
    zonedDate = new Date(utcGuess.getTime() - offsetMs)
  }

  return zonedDate
}

function getTimeZoneOffsetMs(date, timeZone) {
  return parseTimeZoneOffsetMs(
    Utilities.formatDate(date, timeZone, "Z"),
  )
}

function parseTimeZoneOffsetMs(offsetStr) {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(offsetStr)
  if (!match) return 0

  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3])
  return sign * (hours * 60 + minutes) * 60000
}

function parseDateStr(s) {
  return buildDateTime(s, "00:00")
}

function formatDateParts(year, month, day) {
  return (
    String(year) +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  )
}

function formatDate(date) {
  return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd")
}

function getWeekdayIndex(date) {
  return Number(Utilities.formatDate(date, TIMEZONE, "u")) % 7
}

function parseHoldExpiryDescription(desc) {
  const fullMatch = desc.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/)
  if (fullMatch) {
    const date = [fullMatch[3], fullMatch[2], fullMatch[1]].join("-")
    const time = fullMatch[4] + ":" + fullMatch[5]
    return buildDateTime(date, time).getTime()
  }

  const legacyMatch = desc.match(/(\d{2}):(\d{2})/)
  if (legacyMatch) {
    const date = formatDate(new Date())
    const time = legacyMatch[1] + ":" + legacyMatch[2]
    return buildDateTime(date, time).getTime()
  }

  return null
}

function getHoldExpiryTs(event) {
  const desc = event.getDescription() || ""

  const tsMatch = desc.match(/holdUntilTs=(\d+)/)
  if (tsMatch) return Number(tsMatch[1])

  const parsedHoldUntil = parseHoldExpiryDescription(desc)
  if (parsedHoldUntil !== null) return parsedHoldUntil

  const fullMatch = desc.match(/Держать до: (\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/)
  if (fullMatch) {
    return new Date(
      Number(fullMatch[3]),
      Number(fullMatch[2]) - 1,
      Number(fullMatch[1]),
      Number(fullMatch[4]),
      Number(fullMatch[5]),
      0,
      0,
    ).getTime()
  }

  const legacyMatch = desc.match(/Ожидает подтверждения до (\d{2}):(\d{2})/)
  if (legacyMatch) {
    const now = new Date()
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Number(legacyMatch[1]),
      Number(legacyMatch[2]),
      0,
      0,
    ).getTime()
  }

  return event.getEndTime().getTime()
}

function getHoldCreatedTs(event) {
  const desc = event.getDescription() || ""
  const tsMatch = desc.match(/holdCreatedTs=(\d+)/)
  if (tsMatch) return Number(tsMatch[1])

  try {
    return event.getDateCreated().getTime()
  } catch (e) {
    return event.getStartTime().getTime()
  }
}

function isExpiredHoldEvent(event, nowTs) {
  return (
    event.getTitle().startsWith(HOLD_PREFIX) && getHoldExpiryTs(event) <= nowTs
  )
}

function formatDateRu(dateStr) {
  const months = [
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
  const date = buildDateTime(dateStr, "12:00")
  const monthIndex = Number(Utilities.formatDate(date, TIMEZONE, "M")) - 1
  return (
    Utilities.formatDate(date, TIMEZONE, "d") +
    " " +
    months[monthIndex] +
    " " +
    Utilities.formatDate(date, TIMEZONE, "yyyy")
  )
}

function getWeekdayRu(dow) {
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][dow]
}

function getConfiguredAdminPassword() {
  return String(
    PropertiesService.getScriptProperties().getProperty(
      ADMIN_PASSWORD_PROPERTY,
    ) || "",
  ).trim()
}

// ─────────────────────────────────────────────────────────────
// CORS FIX: MimeType.JSON causes a 302 redirect on Apps Script.
// That redirect carries the CORS header, but the *final* response
// does not — so the browser blocks it with "No Access-Control-Allow-Origin".
//
// Solution: serve as plain TEXT. The browser still reads the body
// correctly via r.json() regardless of the declared content-type.
// ─────────────────────────────────────────────────────────────
function jsonResp(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.TEXT,
  )
}

// ─────────────────────────────────────────────────────────────
// DIAGNOSTIC: run this directly in the Apps Script editor
// to verify calendar access without going through HTTP.
// ─────────────────────────────────────────────────────────────
function testCalendarAccess() {
  try {
    const cal = getCalendar()
    Logger.log("✓ Calendar found: " + cal.getName())
    const now = new Date()
    const in1h = new Date(now.getTime() + 3600000)
    const events = cal.getEvents(now, in1h)
    Logger.log("✓ Events in next hour: " + events.length)
    Logger.log("✓ Timezone: " + Session.getScriptTimeZone())
  } catch (e) {
    Logger.log("✗ Error: " + e.message)
  }
}

function testCreateAndDeleteEvent() {
  try {
    const cal = getCalendar()
    const start = new Date()
    start.setHours(start.getHours() + 2, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60000)
    const ev = cal.createEvent("[TEST] Диагностика", start, end, {
      description: "Тестовое событие — можно удалить",
    })
    Logger.log("✓ Event created: " + ev.getTitle() + " at " + start)
    Utilities.sleep(1000)
    ev.deleteEvent()
    Logger.log("✓ Event deleted successfully")
    Logger.log("✓ Calendar write access confirmed!")
  } catch (e) {
    Logger.log("✗ Error: " + e.message)
  }
}


