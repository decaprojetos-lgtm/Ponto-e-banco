import { Employee, ClockRecord, EntryType, Holiday } from './types';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  WORK: 'Trabalho (Ponto)',
  WORK_EXTERNAL: 'Trabalho Externo / Evento',
  MEDICAL: 'Atestado Médico',
  HOLIDAY: 'Feriado',
  ADJUSTMENT: 'Ajuste Manual',
  PAYMENT: 'Pagamento/Saída',
  VACATION: 'Férias',
  BONUS: 'Bônus/Gratificação',
  OFF_DAY: 'Folga Compensatória',
  WORK_RETRO: 'Trabalho Retroativo',
  SUNDAY_WORK: 'Domingo Trabalhado'
};

/**
 * Retorna a data no formato YYYY-MM-DD respeitando o fuso horário local.
 */
export const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Gera uma string ISO completa com o Offset do fuso horário local.
 */
export const getLocalISOString = (date: Date): string => {
  const tzo = -date.getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num: number) => String(Math.floor(Math.abs(num))).padStart(2, '0');
  
  const isoWithoutOffset = date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds());
    
  const offset = dif + pad(tzo / 60) + ':' + pad(tzo % 60);
  
  return isoWithoutOffset + offset;
};

export const formatMinutes = (minutes: number): string => {
  const isNegative = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.floor(abs % 60);
  return `${isNegative ? '-' : '+'}${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
};

export const parseTimeStringToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const isNegative = timeStr.trim().startsWith('-');
  const cleanStr = timeStr.replace('+', '').replace('-', '').trim();
  const parts = cleanStr.split(':');
  
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  
  const total = h * 60 + m;
  return isNegative ? -total : total;
};

export const formatTime = (dateString: string | null | undefined): string => {
  if (!dateString) return '--:--';
  if (dateString.length === 5 && dateString.includes(':')) return dateString;
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '--:--';
  
  return date.toLocaleTimeString('pt-BR', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
};

export const getExpectedMinutesForDate = (employee: Employee, date: Date, holidays: Holiday[] = []): number => {
  if (employee.isHourly) return 0; 
  const dayOfWeek = date.getDay();
  
  // Domingo é sempre 0
  if (dayOfWeek === 0) return 0; 

  // Se for Feriado Cadastrado no Calendário, a meta é 0 (descanso legal)
  const dateStr = getLocalDateString(date);
  if (holidays && holidays.some(h => h.date === dateStr)) {
    return 0;
  }
  
  // Se for o dia configurado como "Dia Curto / Semana Inglesa" do funcionário
  if (dayOfWeek === employee.englishWeekDay) {
    return employee.englishWeekMinutes !== undefined ? employee.englishWeekMinutes : 240;
  }
  
  // Dias normais (Seg-Sex)
  return employee.baseDailyMinutes || 480;
};

export const calculateWorkedMinutes = (record: ClockRecord, now: Date = new Date()): number => {
  if (!record.clockIn) return 0;
  const start = new Date(record.clockIn);
  const end = record.clockOut ? new Date(record.clockOut) : now;
  let totalMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));

  const subFromTotal = (sStr: string | null, eStr: string | null) => {
    if (!sStr) return 0;
    const s = new Date(sStr);
    const e = eStr ? new Date(eStr) : (record.clockOut ? new Date(record.clockOut) : now);
    return Math.max(0, Math.floor((e.getTime() - s.getTime()) / (1000 * 60)));
  };

  // 1. Almoço (Intervalo Intrajornada): desconta integralmente
  totalMinutes -= subFromTotal(record.lunchStart, record.lunchEnd);

  // 2. Lanche (Pausa Concedida): franquia remunerada de 15 min.
  // Desconta apenas o que exceder 15 minutos (ex: 25 min no lanche -> desconta 10 min).
  const snackDuration = subFromTotal(record.snackStart, record.snackEnd);
  const snackExcess = Math.max(0, snackDuration - 15);
  totalMinutes -= snackExcess;

  return Math.max(0, totalMinutes);
};

export const exportToCSV = (mappedData: any[], filename: string) => {
  if (mappedData.length === 0) return;
  const headers = Object.keys(mappedData[0]);
  const csvRows = [
    headers.join(';'), 
    ...mappedData.map(row => 
      headers.map(header => {
        let val = row[header];
        if (val === null || val === undefined) val = "";
        const stringVal = String(val).replace(/"/g, '""');
        return `"${stringVal}"`;
      }).join(';')
    )
  ];
  const csvContent = "\uFEFF" + csvRows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
