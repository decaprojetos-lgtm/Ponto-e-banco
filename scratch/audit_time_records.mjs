import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('='))
    .map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const results = await Promise.all([
  client.from('employees').select('*').order('name'),
  client.from('records').select('*').order('date'),
  client.from('timeBank').select('*').order('date')
]);
const queryError = results.find(result => result.error)?.error;
if (queryError) throw queryError;

const employees = results[0].data || [];
const records = results[1].data || [];
const bank = results[2].data || [];
const today = '2026-07-18';

const field = (row, camel, snake) => row[camel] ?? row[snake] ?? null;
const employeeId = row => field(row, 'employeeId', 'employee_id');
const employeeName = id => employees.find(emp => emp.id === id)?.name || id;
const time = value => value ? new Date(value).toLocaleTimeString('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
}) : '--:--';
const minutesBetween = (start, end) => Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000);
const dateAtNoon = value => new Date(String(value).split('T')[0] + 'T12:00:00-03:00');
const dateKey = value => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const expectedFor = (emp, date) => {
  if (field(emp, 'isHourly', 'is_hourly')) return 0;
  const day = date.getDay();
  if (day === 0) return 0;
  const shortDay = Number(field(emp, 'englishWeekDay', 'english_week_day') ?? 6);
  if (day === shortDay) return Number(field(emp, 'englishWeekMinutes', 'english_week_minutes') ?? 240);
  return Number(field(emp, 'baseDailyMinutes', 'base_daily_minutes') ?? 480);
};
const workedFor = record => {
  const clockIn = field(record, 'clockIn', 'clock_in');
  const clockOut = field(record, 'clockOut', 'clock_out');
  if (!clockIn || !clockOut) return null;
  let total = minutesBetween(clockIn, clockOut);
  for (const [startName, endName, startSnake, endSnake] of [
    ['lunchStart', 'lunchEnd', 'lunch_start', 'lunch_end'],
    ['snackStart', 'snackEnd', 'snack_start', 'snack_end']
  ]) {
    const start = field(record, startName, startSnake);
    const end = field(record, endName, endSnake);
    if (start) total -= Math.max(0, minutesBetween(start, end || clockOut));
  }
  return Math.max(0, total);
};

const groups = new Map();
for (const record of records) {
  const key = `${employeeId(record)}|${record.date}`;
  groups.set(key, [...(groups.get(key) || []), record]);
}
const duplicateRecords = [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({
  employee: employeeName(key.split('|')[0]), date: key.split('|')[1], count: rows.length,
  records: rows.map(row => `${time(field(row, 'clockIn', 'clock_in'))}-${time(field(row, 'clockOut', 'clock_out'))}`)
}));

const bankGroups = new Map();
for (const entry of bank.filter(entry => entry.type === 'WORK')) {
  const key = `${employeeId(entry)}|${entry.date}`;
  bankGroups.set(key, [...(bankGroups.get(key) || []), entry]);
}
const duplicateBank = [...bankGroups.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({
  employee: employeeName(key.split('|')[0]), date: key.split('|')[1], count: rows.length,
  balances: rows.map(row => row.minutes)
}));

const incomplete = [];
const suspicious = [];
const bankMismatch = [];
for (const record of records) {
  const id = employeeId(record);
  const emp = employees.find(item => item.id === id);
  const clockIn = field(record, 'clockIn', 'clock_in');
  const lunchStart = field(record, 'lunchStart', 'lunch_start');
  const lunchEnd = field(record, 'lunchEnd', 'lunch_end');
  const snackStart = field(record, 'snackStart', 'snack_start');
  const snackEnd = field(record, 'snackEnd', 'snack_end');
  const clockOut = field(record, 'clockOut', 'clock_out');
  const label = { employee: employeeName(id), date: record.date };
  const problems = [];
  if (!clockIn) problems.push('sem entrada');
  if (!clockOut && record.date < today) problems.push('sem saída');
  if (Boolean(lunchStart) !== Boolean(lunchEnd) && record.date < today) problems.push('intervalo de almoço incompleto');
  if (Boolean(snackStart) !== Boolean(snackEnd) && record.date < today) problems.push('intervalo de lanche incompleto');
  const ordered = [clockIn, lunchStart, lunchEnd, snackStart, snackEnd, clockOut].filter(Boolean).map(value => new Date(value).getTime());
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) problems.push('batidas fora de ordem');
  if (problems.length) incomplete.push({ ...label, problems, sequence: [clockIn, lunchStart, lunchEnd, snackStart, snackEnd, clockOut].map(time) });

  if (clockIn && clockOut) {
    const rawSpan = minutesBetween(clockIn, clockOut);
    const worked = workedFor(record);
    const expected = Number(field(record, 'expectedMinutes', 'expected_minutes') ?? (emp ? expectedFor(emp, dateAtNoon(record.date)) : 0));
    if (rawSpan > 840) suspicious.push({ ...label, reason: 'permanência superior a 14h', value: rawSpan });
    if (worked > 720) suspicious.push({ ...label, reason: 'trabalho calculado superior a 12h', value: worked });
    if (expected >= 360 && worked < 180) suspicious.push({ ...label, reason: 'menos de 3h trabalhadas em dia de jornada cheia', value: worked });
    const entryRows = bankGroups.get(`${id}|${record.date}`) || [];
    if (entryRows.length === 0) bankMismatch.push({ ...label, reason: 'dia encerrado sem lançamento WORK', calculated: worked - expected });
    if (entryRows.length === 1 && Math.abs(entryRows[0].minutes - (worked - expected)) > 1) {
      bankMismatch.push({ ...label, reason: 'saldo WORK diverge das batidas', stored: entryRows[0].minutes, calculated: worked - expected });
    }
  }
}

for (const [key, entries] of bankGroups) {
  if (!groups.has(key)) bankMismatch.push({
    employee: employeeName(key.split('|')[0]), date: key.split('|')[1], reason: 'lançamento WORK sem registro de ponto',
    stored: entries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0)
  });
}

const missingDays = [];
const balanceBreakdown = [];
for (const emp of employees.filter(emp => field(emp, 'isActive', 'is_active') !== false)) {
  let cursor = dateAtNoon(field(emp, 'startDate', 'start_date') || today);
  const end = dateAtNoon('2026-07-17');
  let missedScheduleMinutes = 0;
  let workBalanceMinutes = 0;
  let manualBalanceMinutes = 0;
  while (cursor <= end) {
    const day = dateKey(cursor);
    const expected = expectedFor(emp, cursor);
    const hasRecord = groups.has(`${emp.id}|${day}`);
    const dayBank = bank.filter(entry => employeeId(entry) === emp.id && entry.date === day);
    const excused = dayBank.some(entry => ['MEDICAL', 'HOLIDAY', 'VACATION', 'OFF_DAY'].includes(entry.type));
    const workEntry = dayBank.find(entry => entry.type === 'WORK');
    if (workEntry) workBalanceMinutes += Number(workEntry.minutes || 0);
    else if (expected > 0 && !excused) {
      missingDays.push({ employee: emp.name, date: day, expected });
      missedScheduleMinutes += expected;
    }
    for (const entry of dayBank.filter(entry => ['ADJUSTMENT', 'WORK_RETRO', 'BONUS'].includes(entry.type))) {
      manualBalanceMinutes += Number(entry.minutes || 0);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  balanceBreakdown.push({
    employee: emp.name,
    initialBalanceMinutes: Number(field(emp, 'initialBalanceMinutes', 'initial_balance_minutes') || 0),
    workBalanceMinutes,
    manualBalanceMinutes,
    missedScheduleMinutes,
    balanceThroughYesterday: Number(field(emp, 'initialBalanceMinutes', 'initial_balance_minutes') || 0)
      + workBalanceMinutes + manualBalanceMinutes - missedScheduleMinutes
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: { employees: employees.length, records: records.length, bankEntries: bank.length },
  dateRange: {
    firstRecord: records[0]?.date || null,
    lastRecord: records.at(-1)?.date || null
  },
  duplicateRecords,
  duplicateBank,
  incomplete,
  suspicious,
  bankMismatch,
  missingDays,
  balanceBreakdown,
  employees: employees.map(emp => ({
    name: emp.name,
    active: field(emp, 'isActive', 'is_active') !== false,
    hourly: Boolean(field(emp, 'isHourly', 'is_hourly')),
    startDate: field(emp, 'startDate', 'start_date'),
    baseDailyMinutes: field(emp, 'baseDailyMinutes', 'base_daily_minutes'),
    shortDay: field(emp, 'englishWeekDay', 'english_week_day'),
    shortDayMinutes: field(emp, 'englishWeekMinutes', 'english_week_minutes')
  }))
};

if (process.argv.includes('--summary')) {
  const summarizeByEmployee = rows => employees.map(emp => {
    const matching = rows.filter(row => row.employee.trim() === emp.name.trim());
    return {
      employee: emp.name.trim(),
      count: matching.length,
      minutes: matching.reduce((sum, row) => sum + Number(row.expected || 0), 0)
    };
  }).filter(item => item.count > 0);
  const manualEntries = bank.filter(entry => ['ADJUSTMENT', 'WORK_RETRO', 'BONUS'].includes(entry.type));
  const manualSummary = employees.map(emp => {
    const matching = manualEntries.filter(entry => employeeId(entry) === emp.id);
    return {
      employee: emp.name.trim(),
      count: matching.length,
      minutes: matching.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0),
      largest: matching
        .filter(entry => Math.abs(Number(entry.minutes || 0)) >= 240)
        .sort((a, b) => Math.abs(Number(b.minutes)) - Math.abs(Number(a.minutes)))
        .slice(0, 8)
        .map(entry => ({ date: entry.date, minutes: entry.minutes, type: entry.type, note: entry.note || '' }))
    };
  }).filter(item => item.count > 0);
  console.log(JSON.stringify({
    totals: report.totals,
    dateRange: report.dateRange,
    duplicateRecords,
    duplicateBank,
    incomplete,
    suspicious,
    bankMismatch,
    missingSummary: summarizeByEmployee(missingDays),
    balanceBreakdown,
    manualSummary
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
