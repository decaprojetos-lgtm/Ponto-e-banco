export enum WeekDay {
  SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6
}

export type EntryType = 
  | 'WORK' 
  | 'WORK_EXTERNAL'
  | 'MEDICAL' 
  | 'HOLIDAY' 
  | 'ADJUSTMENT' 
  | 'PAYMENT' 
  | 'VACATION' 
  | 'BONUS' 
  | 'OFF_DAY' 
  | 'WORK_RETRO'
  | 'SUNDAY_WORK';

export interface Employee {
  id: string;
  name: string;
  role: string;
  baseDailyMinutes: number; 
  englishWeekDay: WeekDay;
  englishWeekMinutes: number; 
  isActive: boolean;
  startDate: string;
  initialBalanceMinutes: number;
  isHourly?: boolean;
  isSalesperson?: boolean; // Participa da Fila da Vez (Vendas em Loja)
}

export interface ClockRecord {
  id: string;
  employeeId: string;
  date: string; 
  clockIn: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  snackStart: string | null;
  snackEnd: string | null;
  clockOut: string | null;
  expectedMinutes: number;
  type: EntryType;
  note?: string;
}

export interface TimeBankEntry {
  id: string;
  employeeId: string;
  date: string;
  minutes: number; 
  type: EntryType;
  note?: string;
}

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  type?: 'NATIONAL' | 'MUNICIPAL' | 'CUSTOM';
}

export interface QueueAttendance {
  id: string;
  employeeId: string;
  date: string;
  startedAt: string; // HH:MM ou ISO
  endedAt?: string;   // HH:MM ou ISO
  durationMinutes?: number;
  type: 'NORMAL' | 'DIRECT'; // NORMAL = Vez da Fila, DIRECT = Cliente Fidelizado / Preferência
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  saleNote?: string; // Nº do Cupom / Valor / Obs da Venda
}

export interface AppSettings {
  managerPin: string;
}

export interface AppData {
  employees: Employee[];
  records: ClockRecord[];
  timeBank: TimeBankEntry[];
  holidays: Holiday[];
  attendances: QueueAttendance[];
  settings?: AppSettings;
}
