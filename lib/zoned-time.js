// Giờ địa phương theo múi giờ IANA (vd. Asia/Seoul) — không phụ thuộc múi giờ của máy chạy máy chủ.
'use strict';

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedNowIn(timeZone, date = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short'
  }).formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0
  };
}

// Mục lịch { time: 'HH:MM', days?: [0..6] } có đến giờ chạy chưa (0 = Chủ nhật)
function isScheduleDue(item, now) {
  if (!item || item.time !== now.time) return false;
  if (Array.isArray(item.days) && !item.days.includes(now.weekday)) return false;
  return true;
}

module.exports = { zonedNowIn, isScheduleDue };
