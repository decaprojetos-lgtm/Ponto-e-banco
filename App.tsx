import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppData, Employee, ClockRecord, TimeBankEntry, EntryType, Holiday, QueueAttendance } from './types';
import { WEEK_DAYS_BR, NAVIGATION_ITEMS, STANDARD_PETROPOLIS_HOLIDAYS_2026 } from './constants';
import { 
  formatMinutes, 
  getExpectedMinutesForDate, 
  calculateWorkedMinutes, 
  formatTime,
  parseTimeStringToMinutes,
  exportToCSV,
  ENTRY_TYPE_LABELS,
  getLocalDateString,
  getLocalISOString
} from './utils';
import { 
  Coffee, Utensils, LogIn, LogOut, ChevronLeft, Lock, 
  UserCheck, X, Clock as ClockIcon, 
  Edit2, Trash2, UserPlus, FileText, Download, 
  TrendingUp, Users, Settings, BookOpen, Sparkles, 
  Plus, RefreshCw, AlertCircle, CheckCircle2, Search,
  Calendar, BrainCircuit, HeartPulse, Palmtree, ShieldCheck,
  History, SlidersHorizontal, Info, Database, AlertTriangle,
  GraduationCap, Briefcase, Minus, Flame, CalendarDays, ArrowRight,
  Play, Check, SkipForward, Pause, Award, Bell, HelpCircle
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://pbvtbwzswkhgeazhwqfa.supabase.co"; 
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_N7XxUfuRSScEe5hMy3Yvag_JHwJd-9I"; 

const isConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
const supabase: SupabaseClient | null = isConfigured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

type ClockEditForm = {
  clockIn: string;
  lunchStart: string;
  lunchEnd: string;
  snackStart: string;
  snackEnd: string;
  clockOut: string;
};

const EMPTY_CLOCK_EDIT_FORM: ClockEditForm = {
  clockIn: '', lunchStart: '', lunchEnd: '',
  snackStart: '', snackEnd: '', clockOut: ''
};

const App: React.FC = () => {
  const [data, setData] = useState<AppData>({
    employees: [],
    records: [],
    timeBank: [],
    holidays: STANDARD_PETROPOLIS_HOLIDAYS_2026.map((h, i) => ({ id: `hol_${i}`, ...h })),
    attendances: [],
    settings: { managerPin: "1234" }
  });
  
  const [activeTab, setActiveTab] = useState('clock'); 
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedClockEmployeeId, setSelectedClockEmployeeId] = useState<string | null>(null);
  const [isManagerAuthenticated, setIsManagerAuthenticated] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [isLoading, setIsLoading] = useState(isConfigured);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingClockRecord, setEditingClockRecord] = useState<ClockRecord | null>(null);
  const [creatingClockRecord, setCreatingClockRecord] = useState<{ employeeId: string; date: string } | null>(null);
  const [clockEditForm, setClockEditForm] = useState<ClockEditForm>(EMPTY_CLOCK_EDIT_FORM);
  const [clockActionEmployeeId, setClockActionEmployeeId] = useState<string | null>(null);
  const [isCltModalOpen, setIsCltModalOpen] = useState(false);
  const clockActionInProgressRef = useRef(false);

  // Autodeclaração de Horário Esquecido pelo Colaborador
  const [isSelfDeclareModalOpen, setIsSelfDeclareModalOpen] = useState(false);
  const [selfDeclareEmployeeId, setSelfDeclareEmployeeId] = useState<string | null>(null);
  const [selfDeclareTime, setSelfDeclareTime] = useState('10:00');
  const [selfDeclareNote, setSelfDeclareNote] = useState('');

  // Estados da Fila da Vez
  const [activeAttendance, setActiveAttendance] = useState<{ employeeId: string; startedAt: string } | null>(null);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [customQueueOrder, setCustomQueueOrder] = useState<string[]>([]);

  // Formulário de Novo Feriado
  const [newHoliday, setNewHoliday] = useState({ date: getLocalDateString(new Date()), name: '', type: 'MUNICIPAL' as const });

  const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const getGreeting = (d: Date = new Date()) => {
    const hour = d.getHours();
    if (hour >= 5 && hour < 12) return { text: 'Bom dia', emoji: '☀️' };
    if (hour >= 12 && hour < 18) return { text: 'Boa tarde', emoji: '🌤️' };
    return { text: 'Boa noite', emoji: '🌙' };
  };

  const DEFAULT_START_DATE = getLocalDateString(new Date());

  const [newEmp, setNewEmp] = useState({ 
    name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, isSalesperson: true, startDate: DEFAULT_START_DATE
  });

  const [adjustmentForm, setAdjustmentForm] = useState({
    employeeId: '',
    date: getLocalDateString(new Date()),
    amountStr: '00:00',
    type: 'ADJUSTMENT' as EntryType,
    isPositive: true,
    note: ''
  });

  const [justificationForm, setJustificationForm] = useState({
    employeeId: '',
    date: getLocalDateString(new Date()),
    endDate: getLocalDateString(new Date()),
    type: 'MEDICAL' as EntryType,
    note: '',
    isRange: false,
    startTime: '08:00',
    endTime: '20:00',
    holidayCompensation: 'HALF_HALF' as 'HALF_HALF' | 'TWO_DAYS_OFF' | 'PAID'
  });

  const [reportFilter, setReportFilter] = useState({
    startDate: getLocalDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: getLocalDateString(new Date()),
    employeeId: 'all'
  });

  const fetchData = async () => {
    if (!supabase) return;
    try {
      const [empsResult, recordsResult, bankResult, settingsResult] = await Promise.all([
        supabase.from('employees').select('*').order('name'),
        supabase.from('records').select('*').order('date', { ascending: false }),
        supabase.from('timeBank').select('*').order('date', { ascending: false }),
        supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      ]);
      const fetchError = empsResult.error || recordsResult.error || bankResult.error || settingsResult.error;
      if (fetchError) throw fetchError;
      const empsRaw = empsResult.data;
      const recs = recordsResult.data;
      const bank = bankResult.data;
      const sett = settingsResult.data;

      let salespersonFlags: Record<string, boolean> = {};
      try {
        const stored = localStorage.getItem('ponto_salesperson_flags_v2');
        if (stored) salespersonFlags = JSON.parse(stored);
      } catch (e) {}

      const normalizedEmployees = (empsRaw || []).map((e: any) => ({
        ...e,
        startDate: e.startDate || e.start_date || DEFAULT_START_DATE,
        baseDailyMinutes: e.baseDailyMinutes || e.base_daily_minutes || 480,
        englishWeekDay: e.englishWeekDay !== undefined ? e.englishWeekDay : (e.english_week_day !== undefined ? e.english_week_day : 6),
        englishWeekMinutes: e.englishWeekMinutes !== undefined ? e.englishWeekMinutes : (e.english_week_minutes !== undefined ? e.english_week_minutes : 240),
        initialBalanceMinutes: e.initialBalanceMinutes || e.initial_balance_minutes || 0,
        isHourly: e.isHourly || e.is_hourly || false,
        isSalesperson: salespersonFlags[e.id] !== undefined 
          ? salespersonFlags[e.id] 
          : (!e.role.toLowerCase().includes('gerente') && !e.role.toLowerCase().includes('estagi'))
      })) as Employee[];

      // Carregar feriados do localStorage se existirem, ou defaults
      let storedHolidays: Holiday[] = STANDARD_PETROPOLIS_HOLIDAYS_2026.map((h, i) => ({ id: `hol_${i}`, ...h }));
      try {
        const localHols = localStorage.getItem('ponto_holidays_v2');
        if (localHols) storedHolidays = JSON.parse(localHols);
      } catch (e) {}

      setData(prev => ({
        ...prev,
        employees: normalizedEmployees,
        records: (recs || []) as ClockRecord[],
        timeBank: (bank || []) as TimeBankEntry[],
        holidays: storedHolidays,
        settings: (sett || { managerPin: "1234" }) as any
      }));
    } catch (err) {
      console.error("Erro ao buscar dados", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Alerta Inteligente de Colaboradores com Entrada Pendente Hoje
  const pendingArrivals = useMemo(() => {
    const todayStr = getLocalDateString(currentTime);
    const dayOfWeek = currentTime.getDay();
    const currentHour = currentTime.getHours();
    const currentMinutes = currentTime.getMinutes();
    const currentTotalMin = currentHour * 60 + currentMinutes;

    // Se for domingo ou feriado cadastrado, não alerta chegada
    if (dayOfWeek === 0) return [];
    if (data.holidays.some(h => h.date === todayStr)) return [];

    const todayClockedEmpIds = new Set(
      data.records.filter(r => r.date === todayStr && r.clockIn).map(r => r.employeeId)
    );

    return data.employees.filter(emp => {
      if (emp.isActive === false) return false;
      if (todayClockedEmpIds.has(emp.id)) return false;

      const isEnglishDayToday = dayOfWeek === emp.englishWeekDay;

      if (isEnglishDayToday) {
        // Hoje é o dia da Semana Inglesa (4h) deste colaborador!
        // O sistema sabe que a entrada é no horário da tarde (14h30 / 15h00).
        // Portanto, NÃO alerta às 10:15! Só alertará se não tiver batido após as 15:15.
        return currentTotalMin >= 915;
      } else {
        // Dia normal (8h): Entrada esperada na abertura da loja às 10:00.
        // Alerta após as 10:15 (15 minutos de tolerância).
        return currentTotalMin >= 615;
      }
    });
  }, [data.employees, data.records, data.holidays, currentTime]);

  // Fila da Vez: Vendedores presentes hoje ordenados por ordem de chegada no ponto
  const salesQueue = useMemo(() => {
    const todayStr = getLocalDateString(currentTime);
    const salesEmployees = data.employees.filter(e => e.isActive !== false && e.isSalesperson !== false);
    const todayRecords = data.records.filter(r => r.date === todayStr);

    const queuedList: {
      employee: Employee;
      record?: ClockRecord;
      status: 'AVAILABLE' | 'ATTENDING' | 'IN_LUNCH' | 'IN_SNACK' | 'LEFT' | 'NOT_ARRIVED';
      orderKey: number;
    }[] = [];

    salesEmployees.forEach(emp => {
      const rec = todayRecords.find(r => r.employeeId === emp.id);
      if (!rec || !rec.clockIn) {
        queuedList.push({ employee: emp, record: rec, status: 'NOT_ARRIVED', orderKey: 9999999999999 });
      } else if (rec.clockOut) {
        queuedList.push({ employee: emp, record: rec, status: 'LEFT', orderKey: 8888888888888 });
      } else if (rec.snackStart && !rec.snackEnd) {
        queuedList.push({ employee: emp, record: rec, status: 'IN_SNACK', orderKey: 7777777777777 });
      } else if (rec.lunchStart && !rec.lunchEnd) {
        queuedList.push({ employee: emp, record: rec, status: 'IN_LUNCH', orderKey: 6666666666666 });
      } else if (activeAttendance && activeAttendance.employeeId === emp.id) {
        queuedList.push({ employee: emp, record: rec, status: 'ATTENDING', orderKey: 0 });
      } else {
        const customIdx = customQueueOrder.indexOf(emp.id);
        const clockTime = new Date(rec.clockIn).getTime();
        const baseKey = customIdx !== -1 ? customIdx : clockTime;
        queuedList.push({ employee: emp, record: rec, status: 'AVAILABLE', orderKey: baseKey });
      }
    });

    const activeInStore = queuedList.filter(q => q.status === 'AVAILABLE' || q.status === 'ATTENDING').sort((a, b) => a.orderKey - b.orderKey);
    const inBreak = queuedList.filter(q => q.status === 'IN_LUNCH' || q.status === 'IN_SNACK');
    const others = queuedList.filter(q => q.status === 'LEFT' || q.status === 'NOT_ARRIVED');

    return { activeInStore, inBreak, others };
  }, [data.employees, data.records, currentTime, activeAttendance, customQueueOrder]);

  const handleStartAttendance = (employeeId: string) => {
    setActiveAttendance({ employeeId, startedAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
  };

  const handleCompleteAttendance = (employeeId: string) => {
    setAttendanceCounts(prev => ({ ...prev, [employeeId]: (prev[employeeId] || 0) + 1 }));
    setActiveAttendance(null);
    setCustomQueueOrder(prev => {
      const currentActiveIds = salesQueue.activeInStore.map(q => q.employee.id);
      const filtered = currentActiveIds.filter(id => id !== employeeId);
      return [...filtered, employeeId];
    });
  };

  const handlePassTurn = (employeeId: string) => {
    setCustomQueueOrder(prev => {
      const currentActiveIds = salesQueue.activeInStore.map(q => q.employee.id);
      const index = currentActiveIds.indexOf(employeeId);
      if (index === -1 || currentActiveIds.length <= 1) return currentActiveIds;
      const reordered = [...currentActiveIds];
      const [moved] = reordered.splice(index, 1);
      reordered.push(moved);
      return reordered;
    });
    if (activeAttendance && activeAttendance.employeeId === employeeId) {
      setActiveAttendance(null);
    }
  };

  // Salvar Autodeclaração de Chegada Esquecida pelo Colaborador
  const handleSaveSelfDeclaration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selfDeclareEmployeeId) return;
    setIsSaving(true);
    try {
      const todayStr = getLocalDateString(currentTime);
      const emp = data.employees.find(e => e.id === selfDeclareEmployeeId)!;
      const expected = getExpectedMinutesForDate(emp, currentTime, data.holidays);
      
      const [h, m] = selfDeclareTime.split(':');
      const arrivalDate = new Date(currentTime);
      arrivalDate.setHours(Number(h), Number(m), 0, 0);
      const arrivalISO = getLocalISOString(arrivalDate);

      const { error } = await supabase.from('records').insert([{
        id: generateId(),
        employeeId: selfDeclareEmployeeId,
        date: todayStr,
        clockIn: arrivalISO,
        expectedMinutes: expected,
        type: 'WORK',
        note: `Entrada autodeclarada pelo colaborador às ${selfDeclareTime}. Motivo: ${selfDeclareNote.trim() || 'Esqueceu de registrar ao chegar'}`
      }]);
      if (error) throw error;
      setIsSelfDeclareModalOpen(false);
      setSelfDeclareEmployeeId(null);
      setSelfDeclareNote('');
      await fetchData();
      alert(`Entrada às ${selfDeclareTime} registrada com sucesso!`);
    } catch (err: any) {
      alert("Erro ao registrar: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Feriados: Adicionar e Remover
  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHoliday.name.trim()) return;
    const item: Holiday = { id: generateId(), date: newHoliday.date, name: newHoliday.name.trim(), type: newHoliday.type };
    const updated = [...data.holidays, item].sort((a, b) => a.date.localeCompare(b.date));
    setData(prev => ({ ...prev, holidays: updated }));
    localStorage.setItem('ponto_holidays_v2', JSON.stringify(updated));
    setNewHoliday({ date: getLocalDateString(new Date()), name: '', type: 'MUNICIPAL' });
    alert("Feriado adicionado ao calendário da loja com sucesso!");
  };

  const handleDeleteHoliday = (id: string) => {
    if (confirm("Deseja remover este feriado do calendário?")) {
      const updated = data.holidays.filter(h => h.id !== id);
      setData(prev => ({ ...prev, holidays: updated }));
      localStorage.setItem('ponto_holidays_v2', JSON.stringify(updated));
    }
  };

  const handleLoadOfficialHolidays = () => {
    const official: Holiday[] = STANDARD_PETROPOLIS_HOLIDAYS_2026.map((h, i) => ({ id: `hol_${i}_${Date.now()}`, ...h }));
    setData(prev => ({ ...prev, holidays: official }));
    localStorage.setItem('ponto_holidays_v2', JSON.stringify(official));
    alert("Feriados Oficiais de Petrópolis (Nacionais e Municipais 2026) carregados!");
  };

  // Cálculo de Saldo Acumulado
  const getCumulativeBalance = (employeeId: string) => {
    const emp = data.employees.find(e => e.id === employeeId);
    if (!emp) return 0;
    
    let totalBalance = emp.initialBalanceMinutes || 0;
    const todayStr = getLocalDateString(currentTime);

    data.timeBank
      .filter(t => t.employeeId === employeeId && t.date < todayStr)
      .forEach(t => { totalBalance += t.minutes; });

    const todayRecord = data.records.find(r => r.employeeId === employeeId && r.date === todayStr);
    const todayManualEntries = data.timeBank.filter(t => t.employeeId === employeeId && t.date === todayStr);

    if (todayRecord && todayRecord.clockIn) {
      if (todayRecord.clockOut) {
        const workedMinutes = calculateWorkedMinutes(todayRecord, currentTime);
        totalBalance += (workedMinutes - todayRecord.expectedMinutes);
      } else {
        const currentWorked = calculateWorkedMinutes(todayRecord, currentTime);
        totalBalance += (currentWorked - todayRecord.expectedMinutes);
      }
    }
    
    todayManualEntries.forEach(ent => {
      if (['ADJUSTMENT', 'WORK_RETRO', 'BONUS', 'WORK_EXTERNAL'].includes(ent.type)) totalBalance += ent.minutes;
    });

    return totalBalance;
  };

  const handleClockAction = async (employeeId: string) => {
    if (!supabase || clockActionInProgressRef.current) return;
    clockActionInProgressRef.current = true;
    setClockActionEmployeeId(employeeId);
    const todayStr = getLocalDateString(currentTime);
    const record = data.records.find(r => r.employeeId === employeeId && r.date === todayStr);
    const nowISO = getLocalISOString(currentTime);

    try {
      if (!record) {
        const emp = data.employees.find(e => e.id === employeeId)!;
        const expected = getExpectedMinutesForDate(emp, currentTime, data.holidays);
        const { error } = await supabase.from('records').insert([{
          id: generateId(),
          employeeId, 
          date: todayStr, 
          clockIn: nowISO, 
          type: 'WORK',
          expectedMinutes: expected
        }]);
        if (error) throw error;
      } else {
        const action = getNextAction(record);
        const update: any = {};
        if (action.stage === 'l_start') update.lunchStart = nowISO;
        else if (action.stage === 'l_end') update.lunchEnd = nowISO;
        else if (action.stage === 's_start') update.snackStart = nowISO;
        else if (action.stage === 's_end') update.snackEnd = nowISO;
        else if (action.stage === 'out') update.clockOut = nowISO;
        
        const { data: savedRecord, error: recordError } = await supabase.from('records')
          .update(update).eq('id', record.id).select('id').maybeSingle();
        if (recordError) throw recordError;
        if (!savedRecord) throw new Error('A batida não foi salva. Verifique as permissões de atualização.');

        if (action.stage === 'out') {
          const worked = calculateWorkedMinutes({ ...record, ...update }, currentTime);
          const { error: bankError } = await supabase.from('timeBank').insert([{
            id: generateId(),
            employeeId, date: todayStr, minutes: worked - record.expectedMinutes, type: 'WORK'
          }]);
          if (bankError) {
            await supabase.from('records').update({ clockOut: record.clockOut }).eq('id', record.id);
            throw bankError;
          }
          setSelectedClockEmployeeId(null);
        }
      }
      await fetchData();
    } catch (e: any) {
      alert('Erro ao registrar ponto: ' + (e?.message || 'falha de conexão.'));
    } finally {
      clockActionInProgressRef.current = false;
      setClockActionEmployeeId(null);
    }
  };

  const handleDeleteFullRecord = async (recordId: string, employeeId: string, date: string) => {
    if (!supabase) return;
    if (confirm(`Tem certeza que deseja EXCLUIR o ponto de ${date}?`)) {
      try {
        await supabase.from('timeBank').delete().match({ employeeId, date, type: 'WORK' });
        await supabase.from('records').delete().eq('id', recordId);
        await fetchData();
        alert("Ponto excluído com sucesso.");
      } catch (e: any) {
        alert("Erro ao excluir: " + e.message);
      }
    }
  };

  const toInputTime = (isoString: string | null | undefined): string => {
    if (!isoString) return '';
    if (isoString.length === 5 && isoString.includes(':')) return isoString;
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const openClockEditor = (record: ClockRecord) => {
    setEditingClockRecord(record);
    setCreatingClockRecord(null);
    setClockEditForm({
      clockIn: toInputTime(record.clockIn),
      lunchStart: toInputTime(record.lunchStart),
      lunchEnd: toInputTime(record.lunchEnd),
      snackStart: toInputTime(record.snackStart),
      snackEnd: toInputTime(record.snackEnd),
      clockOut: toInputTime(record.clockOut)
    });
  };

  const openCreateClockModal = () => {
    const todayStr = getLocalDateString(new Date());
    const firstActiveEmp = data.employees.find(e => e.isActive !== false);
    setCreatingClockRecord({ employeeId: firstActiveEmp?.id || '', date: todayStr });
    setEditingClockRecord(null);
    setClockEditForm({
      clockIn: '10:00', lunchStart: '13:00', lunchEnd: '14:00', snackStart: '', snackEnd: '', clockOut: '19:00'
    });
  };

  const closeClockEditor = () => {
    setEditingClockRecord(null);
    setCreatingClockRecord(null);
    setClockEditForm(EMPTY_CLOCK_EDIT_FORM);
  };

  const handleSaveClockEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || (!editingClockRecord && !creatingClockRecord)) return;

    const targetEmployeeId = editingClockRecord ? editingClockRecord.employeeId : creatingClockRecord?.employeeId;
    const targetDate = editingClockRecord ? editingClockRecord.date : creatingClockRecord?.date;

    if (!targetEmployeeId || !targetDate) {
      alert('Selecione o colaborador e a data da batida.');
      return;
    }

    const employee = data.employees.find(emp => emp.id === targetEmployeeId);
    if (!employee) {
      alert('Colaborador não encontrado.');
      return;
    }

    if (!clockEditForm.clockIn || !clockEditForm.clockOut) {
      alert('Preencha os horários obrigatórios: Entrada e Saída final.');
      return;
    }

    const hasLunchStart = Boolean(clockEditForm.lunchStart);
    const hasLunchEnd = Boolean(clockEditForm.lunchEnd);
    if (hasLunchStart !== hasLunchEnd) {
      alert('Para informar o almoço, preencha o início e o retorno.');
      return;
    }

    const hasSnackStart = Boolean(clockEditForm.snackStart);
    const hasSnackEnd = Boolean(clockEditForm.snackEnd);
    if (hasSnackStart !== hasSnackEnd) {
      alert('Para informar o lanche, preencha o início e o retorno.');
      return;
    }

    setIsSaving(true);
    try {
      const toLocalISO = (timeValue: string) => {
        if (!timeValue) return null;
        const [hours, minutes] = timeValue.split(':');
        const d = new Date(`${targetDate}T12:00:00`);
        d.setHours(Number(hours), Number(minutes), 0, 0);
        return getLocalISOString(d);
      };

      const timestamps = {
        clockIn: toLocalISO(clockEditForm.clockIn),
        lunchStart: toLocalISO(clockEditForm.lunchStart),
        lunchEnd: toLocalISO(clockEditForm.lunchEnd),
        snackStart: toLocalISO(clockEditForm.snackStart),
        snackEnd: toLocalISO(clockEditForm.snackEnd),
        clockOut: toLocalISO(clockEditForm.clockOut)
      };

      const orderedList = [timestamps.clockIn, timestamps.lunchStart, timestamps.lunchEnd,
        timestamps.snackStart, timestamps.snackEnd, timestamps.clockOut].filter(Boolean) as string[];

      for (let i = 1; i < orderedList.length; i++) {
        if (new Date(orderedList[i]).getTime() <= new Date(orderedList[i - 1]).getTime()) {
          throw new Error('A ordem dos horários está inconsistente. Cada batida deve ser posterior à anterior.');
        }
      }

      const dummyRecord: ClockRecord = {
        id: editingClockRecord?.id || 'temp',
        employeeId: targetEmployeeId,
        date: targetDate,
        ...timestamps,
        expectedMinutes: editingClockRecord ? editingClockRecord.expectedMinutes : getExpectedMinutesForDate(employee, new Date(`${targetDate}T12:00:00`), data.holidays),
        type: 'WORK'
      };

      const workedMinutes = calculateWorkedMinutes(dummyRecord, new Date(`${targetDate}T23:59:59`));
      const expectedMinutes = dummyRecord.expectedMinutes;
      const workBalance = workedMinutes - expectedMinutes;

      const previousValues = editingClockRecord ? {
        clockIn: editingClockRecord.clockIn,
        lunchStart: editingClockRecord.lunchStart,
        lunchEnd: editingClockRecord.lunchEnd,
        snackStart: editingClockRecord.snackStart,
        snackEnd: editingClockRecord.snackEnd,
        clockOut: editingClockRecord.clockOut,
        expectedMinutes: editingClockRecord.expectedMinutes
      } : null;

      const recordResult = editingClockRecord
        ? await supabase.from('records').update({ ...timestamps, expectedMinutes })
            .eq('id', editingClockRecord.id).select('id').maybeSingle()
        : await supabase.from('records').insert([{
            id: generateId(),
            employeeId: targetEmployeeId,
            date: targetDate,
            ...timestamps,
            expectedMinutes,
            type: 'WORK'
          }]).select('id').maybeSingle();
      const { data: savedRecord, error: recordError } = recordResult;
      if (recordError) throw recordError;
      if (!savedRecord) throw new Error('O registro não foi salvo. Verifique as permissões de gravação.');

      const workEntry = data.timeBank.find(entry =>
        entry.employeeId === targetEmployeeId && entry.date === targetDate && entry.type === 'WORK'
      );
      const bankResult = workEntry
        ? await supabase.from('timeBank').update({ minutes: workBalance }).eq('id', workEntry.id).select('id').maybeSingle()
        : await supabase.from('timeBank').insert([{
            id: generateId(),
            employeeId: targetEmployeeId, date: targetDate, minutes: workBalance, type: 'WORK'
          }]).select('id').maybeSingle();

      if (bankResult.error || !bankResult.data) {
        const rollback = editingClockRecord && previousValues
          ? await supabase.from('records').update(previousValues).eq('id', editingClockRecord.id)
          : await supabase.from('records').delete().eq('id', savedRecord.id);
        const rollbackMessage = rollback.error
          ? ' A restauração automática também falhou.'
          : ' As batidas anteriores foram restauradas.';
        throw new Error(`Não foi possível recalcular o banco de horas.${rollbackMessage}`);
      }

      await fetchData();
      setEditingClockRecord(null);
      setCreatingClockRecord(null);
      setClockEditForm(EMPTY_CLOCK_EDIT_FORM);
      alert(`${editingClockRecord ? 'Ponto corrigido' : 'Ponto incluído'}. Total trabalhado: ${formatMinutes(workedMinutes)}. Saldo do dia: ${formatMinutes(workBalance)}.`);
    } catch (err: any) {
      alert('Erro ao corrigir ponto: ' + (err?.message || 'falha desconhecida'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveJustification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !justificationForm.employeeId) return;
    setIsSaving(true);
    try {
      const entries = [];

      // Trabalho em Evento Externo
      if (justificationForm.type === 'WORK_EXTERNAL') {
        const emp = data.employees.find(e => e.id === justificationForm.employeeId)!;
        const [sH, sM] = justificationForm.startTime.split(':');
        const [eH, eM] = justificationForm.endTime.split(':');
        const startMins = Number(sH) * 60 + Number(sM);
        const endMins = Number(eH) * 60 + Number(eM);
        const workedMins = Math.max(0, endMins - startMins - 60); // desconta 1h almoço
        const expectedMins = emp.baseDailyMinutes || 480;
        const extraMins = workedMins - expectedMins;

        entries.push({
          id: generateId(),
          employeeId: justificationForm.employeeId,
          date: justificationForm.date,
          minutes: extraMins,
          type: 'WORK_EXTERNAL' as EntryType,
          note: `Evento Externo: ${justificationForm.note.trim() || 'Atendimento Fora'} (${justificationForm.startTime}-${justificationForm.endTime})`
        });
      } else if (justificationForm.type === 'HOLIDAY' && justificationForm.holidayCompensation) {
        // Regra de Petrópolis para Feriado
        let mins = 0;
        let note = 'Feriado Trabalhado (Acordo Petrópolis)';
        if (justificationForm.holidayCompensation === 'HALF_HALF') {
          mins = 480; // 1 folga (8h)
          note = `Feriado Trabalhado (Meio a Meio: +1 Folga creditada + Diária paga no dia) ${justificationForm.note}`;
        } else if (justificationForm.holidayCompensation === 'TWO_DAYS_OFF') {
          mins = 960; // 2 folgas (16h)
          note = `Feriado Trabalhado (Opção 2 Folgas integrais) ${justificationForm.note}`;
        } else {
          mins = 0;
          note = `Feriado Trabalhado (Pago 100% em folha) ${justificationForm.note}`;
        }

        entries.push({
          id: generateId(),
          employeeId: justificationForm.employeeId,
          date: justificationForm.date,
          minutes: mins,
          type: 'HOLIDAY' as EntryType,
          note
        });
      } else if (justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL' || justificationForm.isRange) {
        const startD = new Date(justificationForm.date + "T12:00:00");
        const endD = new Date((justificationForm.endDate || justificationForm.date) + "T12:00:00");
        const loopEnd = endD >= startD ? endD : startD;

        let current = new Date(startD);
        while (current <= loopEnd) {
          entries.push({
            id: generateId(),
            employeeId: justificationForm.employeeId,
            date: getLocalDateString(current),
            minutes: 0, 
            type: justificationForm.type,
            note: justificationForm.note.trim() || (justificationForm.type === 'VACATION' ? 'Férias' : 'Atestado Médico')
          });
          current.setDate(current.getDate() + 1);
        }
      } else {
        entries.push({
          id: generateId(),
          employeeId: justificationForm.employeeId,
          date: justificationForm.date,
          minutes: 0, 
          type: justificationForm.type,
          note: justificationForm.note.trim() || 'Abono/Justificativa'
        });
      }

      const { error } = await supabase.from('timeBank').insert(entries);
      if (error) throw error;
      setJustificationForm({ ...justificationForm, note: '', isRange: false });
      await fetchData();
      alert(`Lançamento de ${entries.length} registro(s) realizado com sucesso!`);
    } catch (err: any) { alert("Erro: " + err.message); } finally { setIsSaving(false); }
  };

  const handleDeleteEntry = async (id: string, message: string) => {
    if (!supabase) return;
    if (confirm(message)) {
      const { error } = await supabase.from('timeBank').delete().eq('id', id);
      if (error) alert("Erro ao excluir: " + error.message);
      else await fetchData();
    }
  };

  // Auditoria de Pendências da Gerência (Ausências sem justificativa e batidas esquecidas)
  const managerPendingItems = useMemo(() => {
    const list: {
      type: 'MISSING_CLOCK_OUT' | 'UNJUSTIFIED_ABSENCE' | 'SNACK_OVERAGE';
      employee: Employee;
      date: string;
      description: string;
      recordId?: string;
    }[] = [];

    const todayStr = getLocalDateString(currentTime);

    // Batidas de dias anteriores sem saída
    data.records.forEach(r => {
      if (r.date < todayStr && r.clockIn && !r.clockOut) {
        const emp = data.employees.find(e => e.id === r.employeeId);
        if (emp && emp.isActive !== false) {
          list.push({
            type: 'MISSING_CLOCK_OUT',
            employee: emp,
            date: r.date,
            description: `Esqueceu de registrar a Saída final em ${safeFormatDate(r.date)}`,
            recordId: r.id
          });
        }
      }
    });

    return list;
  }, [data.records, data.employees, currentTime]);

  const handleExportAccountantReport = () => {
    try {
      const finalReportData: any[] = [];
      const empsToProcess = reportFilter.employeeId === 'all' 
        ? data.employees.filter(e => e.isActive !== false)
        : data.employees.filter(e => e.id === reportFilter.employeeId);

      empsToProcess.forEach(emp => {
        const empRecords = data.records.filter(r => r.employeeId === emp.id && r.date >= reportFilter.startDate && r.date <= reportFilter.endDate);
        empRecords.forEach(r => {
          const worked = r.clockIn && r.clockOut ? calculateWorkedMinutes(r) : 0;
          const balance = worked - (r.expectedMinutes || 480);
          finalReportData.push({
            'Colaborador': emp.name,
            'Cargo': emp.role,
            'Data': r.date,
            'Entrada': formatTime(r.clockIn),
            'I. Almoço': formatTime(r.lunchStart),
            'R. Almoço': formatTime(r.lunchEnd),
            'I. Lanche': formatTime(r.snackStart),
            'R. Lanche': formatTime(r.snackEnd),
            'Saída': formatTime(r.clockOut),
            'Horas Trabalhadas': formatMinutes(worked),
            'Meta': formatMinutes(r.expectedMinutes || 480),
            'Saldo do Dia': formatMinutes(balance)
          });
        });
      });
      
      exportToCSV(finalReportData, 'Relatorio_Ponto_Completo');
    } catch (err: any) {
      alert("Erro ao exportar: " + err.message);
    }
  };

  const filteredRecords = data.records.filter(r => {
    const isDateInRange = r.date >= reportFilter.startDate && r.date <= reportFilter.endDate;
    const isEmployeeMatch = reportFilter.employeeId === 'all' || r.employeeId === reportFilter.employeeId;
    return isDateInRange && isEmployeeMatch;
  });

  const getNextAction = (record?: ClockRecord) => {
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-indigo-600', icon: <LogIn size={20}/> };
    if (!record.lunchStart) return { label: 'Início Almoço', stage: 'l_start', color: 'bg-amber-600', icon: <Utensils size={20}/> };
    if (!record.lunchEnd) return { label: 'Retorno Almoço', stage: 'l_end', color: 'bg-emerald-600', icon: <Utensils size={20}/> };
    if (!record.snackStart) return { label: 'Início Lanche', stage: 's_start', color: 'bg-orange-500', icon: <Coffee size={20}/> };
    if (!record.snackEnd) return { label: 'Retorno Lanche', stage: 's_end', color: 'bg-teal-600', icon: <Coffee size={20}/> };
    if (!record.clockOut) return { label: 'Saída Final', stage: 'out', color: 'bg-rose-600', icon: <LogOut size={20}/> };
    return { label: 'Finalizado', stage: 'done', color: 'bg-slate-800', icon: <UserCheck size={20}/> };
  };

  const handlePinDigit = (digit: string) => {
    if (pinInput.length < 4) {
      const currentPin = data.settings?.managerPin || "1234";
      const nextPin = pinInput + digit;
      setPinInput(nextPin);
      if (nextPin === currentPin) {
        setIsManagerAuthenticated(true);
        setIsLoginModalOpen(false);
        setPinInput('');
        setActiveTab('dashboard');
      } else if (nextPin.length === 4) {
        setLoginError(true);
        setTimeout(() => { setPinInput(''); setLoginError(false); }, 600);
      }
    }
  };

  const safeFormatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "N/A";
    const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = cleanDate.split('-');
    if (parts.length !== 3) return cleanDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col md:flex-row text-slate-200 overflow-x-hidden">
      
      {/* SIDEBAR */}
      <aside className="w-full md:w-64 bg-[#1e293b] flex flex-col shadow-2xl md:fixed md:inset-y-0 z-50 overflow-y-auto">
        <div className="p-6 border-b border-white/5 flex flex-col items-center">
          <div className="bg-indigo-600 p-2.5 rounded-xl text-white shadow-xl mb-3"><BookOpen size={24}/></div>
          <span className="text-white font-serif italic text-lg tracking-tight">Ponto & Banco</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {/* Módulos Públicos da Loja */}
          <button onClick={() => { setActiveTab('clock'); setIsManagerAuthenticated(false); setSelectedClockEmployeeId(null); }} className={`w-full flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-xs transition-all ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>
            <ClockIcon size={18}/> Bater Ponto
          </button>
          <button onClick={() => { setActiveTab('queue'); setIsManagerAuthenticated(false); }} className={`w-full flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-xs transition-all ${activeTab === 'queue' ? 'bg-amber-500 text-slate-900 shadow-lg font-black' : 'text-amber-400 hover:bg-white/5'}`}>
            <Flame size={18}/> Fila da Vez (Vendas)
          </button>

          {/* Módulos de Gestão */}
          <div className="pt-6 opacity-30 px-5 text-[9px] font-black uppercase tracking-widest mb-1">Gestão</div>
          {[
            { id: 'dashboard', label: 'Painel Geral', icon: <TrendingUp size={18}/> },
            { id: 'employees', label: 'Equipe', icon: <Users size={18}/> },
            { id: 'holidays', label: 'Feriados', icon: <CalendarDays size={18}/> },
            { id: 'justifications', label: 'Justificativas', icon: <ShieldCheck size={18}/> },
            { id: 'admin', label: 'Ajustes', icon: <SlidersHorizontal size={18}/> },
            { id: 'reports', label: 'Relatórios', icon: <FileText size={18}/> },
          ].map(item => (
            <button key={item.id} onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} className={`w-full flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-xs transition-all ${activeTab === item.id && isManagerAuthenticated ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/5'}`}>
              {item.icon} {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 md:p-10 md:ml-64 bg-slate-50 text-slate-900 min-h-screen">
        <header className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Sistema de Ponto</p>
            <h1 className="text-3xl font-black font-serif italic capitalize leading-none">
              {activeTab === 'queue' ? 'Fila da Vez de Atendimento' : activeTab === 'holidays' ? 'Calendário de Feriados' : activeTab}
            </h1>
          </div>
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-100 text-right w-full sm:w-auto">
            <p className="text-xl font-mono font-black text-slate-800 leading-none">{currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second: '2-digit'})}</p>
          </div>
        </header>

        <div className="max-w-6xl mx-auto">
          
          {/* TAB: BATER PONTO */}
          {activeTab === 'clock' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* BANNER DE AVISO: COLABORADORES AGUARDANDO ENTRADA HOJE */}
              {pendingArrivals.length > 0 && !selectedClockEmployeeId && (
                <div className="bg-amber-50 border border-amber-200 p-4 md:p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                      <Bell size={16}/>
                    </div>
                    <div>
                      <p className="text-xs font-black text-amber-950 uppercase tracking-wider">Aguardando Batida de Entrada Hoje:</p>
                      <p className="text-xs font-bold text-amber-800 mt-0.5">
                        {pendingArrivals.map(e => e.name.split(' ')[0]).join(', ')} ainda não registraram entrada.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-black text-amber-700 bg-amber-100/70 px-2.5 py-1 rounded-lg">
                    Lembrete da Escala
                  </span>
                </div>
              )}

              {!selectedClockEmployeeId ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {data.employees.filter(e => e.isActive !== false).map(emp => {
                    const todayRec = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const isPending = pendingArrivals.some(p => p.id === emp.id);
                    return (
                      <button key={emp.id} onClick={() => setSelectedClockEmployeeId(emp.id)} className={`bg-white p-6 rounded-3xl shadow-sm hover:shadow-md transition-all border flex flex-col items-center group relative ${isPending ? 'border-amber-300' : 'border-slate-100'}`}>
                        {isPending && (
                          <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                        )}
                        <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center text-2xl font-black mb-3 group-hover:bg-indigo-600 group-hover:text-white transition-all">{emp.name.charAt(0)}</div>
                        <span className="font-bold text-slate-700 truncate w-full text-center text-sm">{emp.name.split(' ')[0]}</span>
                        <span className="text-[10px] text-slate-400 truncate w-full text-center mt-0.5">{emp.role || 'Colaborador'}</span>
                        {todayRec?.clockIn && (
                          <span className="mt-2 text-[9px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                            Entrada {formatTime(todayRec.clockIn)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="max-w-3xl mx-auto w-full space-y-6">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-slate-400 font-black uppercase text-[10px] hover:text-indigo-600"><ChevronLeft size={14}/> Voltar para lista</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const balance = getCumulativeBalance(emp.id);
                    const record = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const action = getNextAction(record);
                    return (
                      <div key={emp.id} className="space-y-6">
                        <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-xl border border-slate-100 flex flex-col items-center text-center">
                          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider mb-3">
                            <span>{getGreeting(currentTime).emoji}</span>
                            <span>{getGreeting(currentTime).text}, {emp.name.split(' ')[0]}!</span>
                          </div>
                          <h2 className="text-3xl font-black font-serif italic mb-1">{emp.name}</h2>
                          <p className="text-slate-400 font-bold uppercase text-[10px] mb-4 tracking-widest">{emp.role}</p>
                          
                          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
                            <button
                              type="button"
                              onClick={() => setIsCltModalOpen(true)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
                            >
                              <BookOpen size={14} className="text-indigo-600"/>
                              <span>Regras CLT & Direitos de Ponto</span>
                            </button>
                          </div>

                          <button disabled={action.stage === 'done' || clockActionEmployeeId !== null} onClick={() => handleClockAction(emp.id)} className={`w-full max-w-md py-10 rounded-[2.5rem] font-black text-2xl shadow-xl transition-all flex items-center justify-center gap-4 ${action.color} text-white active:scale-95 mb-4 disabled:opacity-60`}>
                            {clockActionEmployeeId === emp.id ? <RefreshCw className="animate-spin" size={20}/> : action.icon} {clockActionEmployeeId === emp.id ? 'Salvando...' : action.label}
                          </button>

                          {/* BOTÃO AUTODECLARAÇÃO: ESQUECI DE BATER AO CHEGAR */}
                          {!record?.clockIn && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelfDeclareEmployeeId(emp.id);
                                setSelfDeclareTime(currentTime.getDay() === emp.englishWeekDay ? '14:30' : '10:00');
                                setIsSelfDeclareModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-indigo-600 text-xs font-bold transition-all py-1 mb-8"
                            >
                              <HelpCircle size={14}/>
                              <span>Esqueceu de bater ao chegar? <strong className="underline">Informar horário exato</strong></span>
                            </button>
                          )}

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-2xl mt-4">
                             {[
                               { l: 'Entrada', v: record?.clockIn, i: <LogIn size={14}/> },
                               { l: 'I. Almoço', v: record?.lunchStart, i: <Utensils size={14}/> },
                               { l: 'R. Almoço', v: record?.lunchEnd, i: <Utensils size={14}/> },
                               { l: 'I. Lanche', v: record?.snackStart, i: <Coffee size={14}/> },
                               { l: 'R. Lanche', v: record?.snackEnd, i: <Coffee size={14}/> },
                               { l: 'Saída', v: record?.clockOut, i: <LogOut size={14}/> },
                             ].map((t, idx) => (
                               <div key={idx} className={`p-4 rounded-2xl border transition-all ${t.v ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50 border-slate-100 opacity-40'}`}>
                                  <div className="flex items-center justify-center gap-2 mb-1">
                                    <span className="text-indigo-400">{t.i}</span>
                                    <p className="text-[8px] font-black text-slate-400 uppercase">{t.l}</p>
                                  </div>
                                  <p className="font-mono font-black text-lg text-slate-800">{formatTime(t.v)}</p>
                               </div>
                             ))}
                          </div>
                        </div>
                        <div className="bg-[#1e293b] text-white p-8 rounded-[2.5rem] flex flex-col items-center justify-center shadow-xl text-center relative overflow-hidden">
                          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 relative z-10">Saldo Acumulado</p>
                          <p className={`text-5xl font-mono font-black relative z-10 ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatMinutes(balance)}</p>
                          <div className="absolute top-0 right-0 p-4 opacity-5"><ClockIcon size={120}/></div>
                        </div>

                        {/* Employee History Table */}
                        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                          <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase text-slate-400 tracking-widest">Meu Histórico Recente</h3>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => window.print()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 text-slate-600 text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
                                title="Imprimir meu extrato de ponto"
                              >
                                <Download size={12}/>
                                <span>Imprimir Meu Espelho</span>
                              </button>
                              <History size={16} className="text-slate-300"/>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-[10px] font-bold">
                              <thead className="bg-slate-50 text-[8px] font-black uppercase text-slate-400 border-b border-slate-100">
                                <tr>
                                  <th className="px-6 py-3">Data</th>
                                  <th className="px-6 py-3">Entrada/Saída</th>
                                  <th className="px-6 py-3 text-center">Almoço</th>
                                  <th className="px-6 py-3 text-center">Lanche</th>
                                  <th className="px-6 py-3 text-center">Saldo</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {(() => {
                                  const timelineItems: any[] = [];
                                  data.records.filter(r => r.employeeId === emp.id).forEach(r => {
                                    timelineItems.push({ type: 'RECORD', date: r.date, data: r });
                                  });
                                  data.timeBank
                                    .filter(t => t.employeeId === emp.id && ['MEDICAL', 'VACATION', 'HOLIDAY', 'OFF_DAY', 'WORK_EXTERNAL'].includes(t.type))
                                    .forEach(t => {
                                      timelineItems.push({ type: 'ABSENCE', date: t.date, data: t });
                                    });
                                  timelineItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || (a.type === 'RECORD' ? -1 : 1));
                                  const itemsToShow = timelineItems.slice(0, 15);
                                  if (itemsToShow.length === 0) {
                                    return <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-300 italic">Nenhum registro encontrado</td></tr>;
                                  }
                                  return itemsToShow.map((item, index) => {
                                    if (item.type === 'RECORD') {
                                      const r = item.data;
                                      const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
                                      return (
                                        <tr key={`rec-${r.id}-${index}`}>
                                          <td className="px-6 py-3 font-mono text-slate-500">{safeFormatDate(r.date)}</td>
                                          <td className="px-6 py-3 text-slate-700 whitespace-nowrap">{formatTime(r.clockIn)} - {formatTime(r.clockOut)}</td>
                                          <td className="px-6 py-3 text-center text-slate-400 font-mono">{r.lunchStart ? `${formatTime(r.lunchStart)}-${formatTime(r.lunchEnd)}` : '---'}</td>
                                          <td className="px-6 py-3 text-center text-slate-400 font-mono">{r.snackStart ? `${formatTime(r.snackStart)}-${formatTime(r.snackEnd)}` : '---'}</td>
                                          <td className={`px-6 py-3 text-center font-mono ${tbe && tbe.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{tbe ? formatMinutes(tbe.minutes) : '--:--'}</td>
                                        </tr>
                                      );
                                    } else {
                                      const t = item.data;
                                      return (
                                        <tr key={`abs-${t.id}-${index}`} className="bg-indigo-50/40">
                                          <td className="px-6 py-3 font-mono text-slate-500">{safeFormatDate(t.date)}</td>
                                          <td colSpan={3} className="px-6 py-3 text-center text-indigo-600 font-black uppercase text-[9px] tracking-widest">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]} {t.note ? `• ${t.note}` : ''}</td>
                                          <td className="px-6 py-3 text-center font-mono text-slate-400">Abonado</td>
                                        </tr>
                                      );
                                    }
                                  });
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB: FILA DA VEZ (VENDAS) */}
          {activeTab === 'queue' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white p-8 rounded-[2.5rem] shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-xs font-black uppercase tracking-wider mb-2">
                    <Flame size={14}/> Fila de Atendimento em Loja
                  </div>
                  <h2 className="text-3xl font-black font-serif italic">Ordem de Atendimento</h2>
                  <p className="text-amber-100 text-xs mt-1">Organizada automaticamente pela ordem de chegada no ponto. Vendedores em pausa saem da fila sozinhos.</p>
                </div>
                <div className="bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl text-center border border-white/20">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-200">Na Loja Agora</span>
                  <p className="text-3xl font-black font-mono mt-0.5">{salesQueue.activeInStore.length} Vendedores</p>
                </div>
              </div>

              {/* VENDEDOR DA VEZ (1º LUGAR) */}
              {salesQueue.activeInStore.length > 0 ? (
                (() => {
                  const firstInLine = salesQueue.activeInStore[0];
                  const isAttending = activeAttendance && activeAttendance.employeeId === firstInLine.employee.id;
                  const count = attendanceCounts[firstInLine.employee.id] || 0;
                  return (
                    <div className={`p-8 md:p-10 rounded-[3rem] shadow-xl border-2 transition-all text-center relative overflow-hidden ${isAttending ? 'bg-indigo-600 border-indigo-700 text-white shadow-indigo-200' : 'bg-white border-amber-400 text-slate-800'}`}>
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-widest mb-4 shadow-sm">
                        <Award size={14}/> {isAttending ? 'ATENDENDO CLIENTE AGORA' : '1º LUGAR • VENDEDOR DA VEZ'}
                      </div>
                      <h3 className="text-4xl font-black font-serif italic mb-1">{firstInLine.employee.name}</h3>
                      <p className={`text-xs font-bold uppercase tracking-wider mb-6 ${isAttending ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {firstInLine.employee.role} • Chegou às {formatTime(firstInLine.record?.clockIn)} • {count} atendimentos hoje
                      </p>

                      <div className="flex flex-wrap items-center justify-center gap-4 max-w-lg mx-auto">
                        {!isAttending ? (
                          <>
                            <button
                              onClick={() => handleStartAttendance(firstInLine.employee.id)}
                              className="flex-1 py-4 px-6 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                            >
                              <Play size={18}/> Iniciar Atendimento
                            </button>
                            <button
                              onClick={() => handlePassTurn(firstInLine.employee.id)}
                              className="py-4 px-5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5"
                              title="Passar a vez caso o vendedor esteja ocupado"
                            >
                              <SkipForward size={16}/> Passar a Vez
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleCompleteAttendance(firstInLine.employee.id)}
                              className="flex-1 py-4 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                            >
                              <Check size={20}/> Concluir Atendimento
                            </button>
                            <button
                              onClick={() => setActiveAttendance(null)}
                              className="py-4 px-5 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-black text-xs uppercase tracking-wider transition-all"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="bg-white p-12 rounded-[2.5rem] shadow-sm border border-slate-100 text-center">
                  <ClockIcon size={48} className="mx-auto text-slate-300 mb-3"/>
                  <h3 className="text-lg font-black text-slate-700">Nenhum vendedor disponível na fila no momento</h3>
                  <p className="text-xs text-slate-400 mt-1">Conforme os vendedores baterem o ponto de entrada, eles entrarão aqui automaticamente.</p>
                </div>
              )}

              {/* PRÓXIMOS NA FILA */}
              {salesQueue.activeInStore.length > 1 && (
                <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Próximos na Fila</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {salesQueue.activeInStore.slice(1).map((q, idx) => (
                      <div key={q.employee.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-xl bg-slate-200 text-slate-700 text-xs font-black flex items-center justify-center">{idx + 2}º</span>
                          <div>
                            <p className="font-bold text-xs text-slate-800">{q.employee.name.split(' ')[0]}</p>
                            <p className="text-[9px] text-slate-400">{attendanceCounts[q.employee.id] || 0} atendimentos</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handlePassTurn(q.employee.id)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-white transition-all"
                          title="Passar para o fim da fila"
                        >
                          <SkipForward size={14}/>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* VENDEDORES EM PAUSA (ALMOÇO OU LANCHE) */}
              {salesQueue.inBreak.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 p-6 rounded-[2rem] space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 text-xs font-black uppercase tracking-wider">
                    <Pause size={16}/> Em Intervalo (Fora da Fila Temporariamente)
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {salesQueue.inBreak.map(q => (
                      <div key={q.employee.id} className="px-4 py-2 rounded-xl bg-white border border-amber-200 shadow-sm flex items-center gap-2 text-xs font-bold text-amber-950">
                        <span>{q.status === 'IN_LUNCH' ? '🍽️' : '☕'}</span>
                        <span>{q.employee.name.split(' ')[0]}</span>
                        <span className="text-[10px] text-amber-600 uppercase font-black">({q.status === 'IN_LUNCH' ? 'Almoço' : 'Lanche'})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: CALENDÁRIO DE FERIADOS */}
          {activeTab === 'holidays' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black font-serif italic text-slate-800">Calendário de Feriados</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Feriados cadastrados aqui têm meta automática de 0h para quem folgar, sem gerar faltas ou débitos.</p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadOfficialHolidays}
                  className="px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2"
                >
                  <RefreshCw size={14}/> Carregar Feriados de Petrópolis (2026)
                </button>
              </div>

              {/* Form Adicionar Feriado */}
              <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
                <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-4">Adicionar Novo Feriado</h3>
                <form onSubmit={handleAddHoliday} className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4 items-end">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-slate-400">Data *</span>
                    <input
                      type="date"
                      required
                      value={newHoliday.date}
                      onChange={e => setNewHoliday({ ...newHoliday, date: e.target.value })}
                      className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-black text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] font-black uppercase text-slate-400">Nome do Feriado *</span>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Aniversário de Petrópolis"
                      value={newHoliday.name}
                      onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })}
                      className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </label>
                  <button
                    type="submit"
                    className="py-3 px-5 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider shadow-md hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={16}/> Salvar Feriado
                  </button>
                </form>
              </div>

              {/* Lista de Feriados Cadastrados */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Feriados Ativos ({data.holidays.length})</h3>
                  <CalendarDays size={16} className="text-slate-300"/>
                </div>
                <div className="divide-y divide-slate-100">
                  {data.holidays.map(h => (
                    <div key={h.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-all">
                      <div className="flex items-center gap-4">
                        <span className="font-mono font-black text-sm text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl">{safeFormatDate(h.date)}</span>
                        <div>
                          <p className="font-bold text-sm text-slate-800">{h.name}</p>
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">{h.type === 'MUNICIPAL' ? 'Feriado Municipal de Petrópolis' : 'Feriado Nacional'}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteHoliday(h.id)}
                        className="p-2 text-slate-300 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all"
                        title="Excluir feriado"
                      >
                        <Trash2 size={16}/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              
              {/* PENDÊNCIAS E ALERTAS DA GERÊNCIA */}
              {managerPendingItems.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 p-6 md:p-8 rounded-[2.5rem] shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-amber-900 font-black text-sm uppercase tracking-wider">
                    <AlertTriangle size={18} className="text-amber-600"/>
                    <span>Pendências de Ponto para Revisão ({managerPendingItems.length})</span>
                  </div>
                  <div className="space-y-2">
                    {managerPendingItems.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-2xl border border-amber-200/60 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-xs text-slate-800">{item.employee.name} • {item.description}</p>
                        </div>
                        <button
                          onClick={() => {
                            const rec = data.records.find(r => r.id === item.recordId);
                            if (rec) openClockEditor(rec);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-wider hover:bg-indigo-700 transition-all flex items-center gap-1 shrink-0"
                        >
                          <Edit2 size={12}/> Corrigir Horário
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CARDS RESUMO DO DIA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Presentes na Loja</span>
                  <p className="text-3xl font-black font-mono text-indigo-600 mt-2">
                    {data.records.filter(r => r.date === getLocalDateString(currentTime) && r.clockIn && !r.clockOut).length}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Em Intervalo</span>
                  <p className="text-3xl font-black font-mono text-amber-600 mt-2">
                    {data.records.filter(r => r.date === getLocalDateString(currentTime) && ((r.lunchStart && !r.lunchEnd) || (r.snackStart && !r.snackEnd))).length}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Feriados Ativos</span>
                  <p className="text-3xl font-black font-mono text-emerald-600 mt-2">{data.holidays.length}</p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Colaboradores</span>
                  <p className="text-3xl font-black font-mono text-slate-800 mt-2">{data.employees.filter(e => e.isActive !== false).length}</p>
                </div>
              </div>

              {/* QUADRO GERAL DOS COLABORADORES */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Status Geral da Equipe Hoje</h3>
                  <Users size={16} className="text-slate-300"/>
                </div>
                <div className="divide-y divide-slate-100">
                  {data.employees.map(emp => {
                    const todayRec = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const balance = getCumulativeBalance(emp.id);
                    return (
                      <div key={emp.id} className="px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 font-black text-sm flex items-center justify-center">{emp.name.charAt(0)}</div>
                          <div>
                            <p className="font-bold text-sm text-slate-800">{emp.name}</p>
                            <p className="text-[10px] text-slate-400">{emp.role || 'Sem Cargo'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="text-[9px] font-black uppercase text-slate-400 block">Entrada Hoje</span>
                            <span className="font-mono font-bold text-xs text-slate-700">{formatTime(todayRec?.clockIn)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-black uppercase text-slate-400 block">Saldo Banco</span>
                            <span className={`font-mono font-black text-xs ${balance >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(balance)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB: EQUIPE (FUNCIONÁRIOS) */}
          {activeTab === 'employees' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
                <h3 className="text-xl font-black font-serif italic mb-4">{editingEmployeeId ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!supabase) return;
                  setIsSaving(true);
                  const payload: any = {
                    name: newEmp.name,
                    role: newEmp.role,
                    baseDailyMinutes: newEmp.isHourly ? 0 : parseInt(newEmp.dailyHours) * 60,
                    englishWeekDay: parseInt(newEmp.englishDay),
                    englishWeekMinutes: newEmp.isHourly ? 0 : parseInt(newEmp.shortDayHours) * 60,
                    initialBalanceMinutes: parseTimeStringToMinutes(newEmp.initialBalanceStr),
                    startDate: newEmp.startDate,
                    isHourly: newEmp.isHourly
                  };

                  try {
                    const targetId = editingEmployeeId || generateId();
                    const { error } = editingEmployeeId
                      ? await supabase.from('employees').update(payload).eq('id', editingEmployeeId)
                      : await supabase.from('employees').insert([{ id: targetId, ...payload }]);
                    if (error) throw error;

                    try {
                      const flags = JSON.parse(localStorage.getItem('ponto_salesperson_flags_v2') || '{}');
                      flags[targetId] = newEmp.isSalesperson;
                      localStorage.setItem('ponto_salesperson_flags_v2', JSON.stringify(flags));
                    } catch (e) {}

                    alert("Colaborador salvo com sucesso!");
                    setEditingEmployeeId(null);
                    setNewEmp({ name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, isSalesperson: true, startDate: DEFAULT_START_DATE });
                    await fetchData();
                  } catch (err: any) {
                    alert("Erro ao salvar: " + err.message);
                  } finally {
                    setIsSaving(false);
                  }
                }} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Nome Completo *</span>
                      <input required value={newEmp.name} onChange={e => setNewEmp({ ...newEmp, name: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Nome do colaborador"/>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Cargo / Função</span>
                      <input value={newEmp.role} onChange={e => setNewEmp({ ...newEmp, role: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Ex: Vendedor, Gerente"/>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Jornada Padrão</span>
                      <select value={newEmp.dailyHours} onChange={e => setNewEmp({ ...newEmp, dailyHours: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="8">8 horas / dia (CLT)</option>
                        <option value="6">6 horas / dia (Estágio - Patrícia)</option>
                        <option value="4">4 horas / dia</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Dia Curto ou Folga Semanal</span>
                      <select 
                        value={`${newEmp.englishDay}_${newEmp.shortDayHours}`} 
                        onChange={e => {
                          const [d, h] = e.target.value.split('_');
                          setNewEmp({ ...newEmp, englishDay: d, shortDayHours: h });
                        }} 
                        className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <optgroup label="Semana Inglesa (4 horas no dia)">
                          <option value="1_4">Segunda-feira (4h)</option>
                          <option value="2_4">Terça-feira (4h)</option>
                          <option value="3_4">Quarta-feira (4h)</option>
                          <option value="4_4">Quinta-feira (4h)</option>
                          <option value="5_4">Sexta-feira (4h)</option>
                          <option value="6_4">Sábado (4h)</option>
                        </optgroup>
                        <optgroup label="Folga Fixa na Semana (0h - Não Trabalha)">
                          <option value="1_0">Segunda-feira (Folga Fixa - 0h)</option>
                          <option value="2_0">Terça-feira (Folga Fixa - 0h)</option>
                          <option value="3_0">Quarta-feira (Folga Fixa - 0h) [Patrícia]</option>
                          <option value="4_0">Quinta-feira (Folga Fixa - 0h)</option>
                          <option value="5_0">Sexta-feira (Folga Fixa - 0h)</option>
                          <option value="6_0">Sábado (Folga Fixa - 0h)</option>
                        </optgroup>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Saldo Inicial</span>
                      <input value={newEmp.initialBalanceStr} onChange={e => setNewEmp({ ...newEmp, initialBalanceStr: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500" placeholder="00:00"/>
                    </label>
                  </div>

                  {/* Opção Fila da Vez */}
                  <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-amber-950">Participa da Fila da Vez (Vendas em Loja)</p>
                      <p className="text-[10px] text-amber-700">Marque para vendedores de atendimento. Desmarque para cargos administrativos e estagiários.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={newEmp.isSalesperson}
                      onChange={e => setNewEmp({ ...newEmp, isSalesperson: e.target.checked })}
                      className="w-5 h-5 accent-amber-600 rounded cursor-pointer"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    {editingEmployeeId && (
                      <button type="button" onClick={() => { setEditingEmployeeId(null); setNewEmp({ name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, isSalesperson: true, startDate: DEFAULT_START_DATE }); }} className="py-3 px-5 rounded-xl bg-slate-100 text-slate-600 font-black text-xs uppercase">Cancelar</button>
                    )}
                    <button type="submit" disabled={isSaving} className="py-3 px-6 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider shadow-md hover:bg-indigo-700 transition-all flex items-center gap-2">
                      {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <UserPlus size={14}/>} {editingEmployeeId ? 'Atualizar Colaborador' : 'Cadastrar Colaborador'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Lista de Colaboradores */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Equipe Ativa ({data.employees.length})</h3>
                  <Users size={16} className="text-slate-300"/>
                </div>
                <div className="divide-y divide-slate-100">
                  {data.employees.map(emp => (
                    <div key={emp.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-all">
                      <div>
                        <p className="font-bold text-sm text-slate-800 flex items-center gap-2">
                          {emp.name}
                          {emp.isSalesperson && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[8px] font-black uppercase tracking-wider">Fila da Vez</span>}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {emp.role} • {(emp.baseDailyMinutes || 480)/60}h/dia • {emp.englishWeekMinutes === 0 ? `Folga Fixa: ${WEEK_DAYS_BR[emp.englishWeekDay]}` : `Semana Inglesa: ${WEEK_DAYS_BR[emp.englishWeekDay]} (4h)`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingEmployeeId(emp.id);
                            setNewEmp({
                              name: emp.name,
                              role: emp.role,
                              dailyHours: String((emp.baseDailyMinutes || 480) / 60),
                              englishDay: String(emp.englishWeekDay),
                              shortDayHours: String((emp.englishWeekMinutes !== undefined ? emp.englishWeekMinutes : 240) / 60),
                              initialBalanceStr: formatMinutes(emp.initialBalanceMinutes || 0).replace('+', ''),
                              isHourly: emp.isHourly || false,
                              isSalesperson: emp.isSalesperson !== false,
                              startDate: emp.startDate
                            });
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-all"
                        >
                          <Edit2 size={16}/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: JUSTIFICATIVAS / EVENTOS EXTERNOS */}
          {activeTab === 'justifications' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
                <h3 className="text-xl font-black font-serif italic mb-4">Lançar Justificativa ou Evento Externo</h3>
                <form onSubmit={handleSaveJustification} className="space-y-4">
                  <div className={`grid grid-cols-1 ${justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Colaborador *</span>
                      <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({ ...justificationForm, employeeId: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Selecione...</option>
                        {data.employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">Tipo de Lançamento *</span>
                      <select value={justificationForm.type} onChange={e => {
                        const newType = e.target.value as EntryType;
                        setJustificationForm(prev => ({
                          ...prev,
                          type: newType,
                          endDate: prev.endDate < prev.date ? prev.date : prev.endDate
                        }));
                      }} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="VACATION">🌴 Férias (Período)</option>
                        <option value="MEDICAL">🩺 Atestado Médico</option>
                        <option value="OFF_DAY">🏖️ Folga Compensatória (de Domingo/Feriado)</option>
                        <option value="WORK_EXTERNAL">🎪 Trabalho em Evento Externo</option>
                        <option value="HOLIDAY">🚩 Feriado Trabalhado (Regra Petrópolis)</option>
                        <option value="BONUS">⭐ Bônus / Gratificação</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-slate-400">{justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL' ? 'Data Início *' : 'Data *'}</span>
                      <input type="date" required value={justificationForm.date} onChange={e => {
                        const newStart = e.target.value;
                        setJustificationForm(prev => ({
                          ...prev,
                          date: newStart,
                          endDate: prev.endDate < newStart ? newStart : prev.endDate
                        }));
                      }} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-black text-xs outline-none focus:ring-2 focus:ring-indigo-500"/>
                    </label>
                    {(justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL') && (
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-400">Data Fim *</span>
                        <input type="date" required min={justificationForm.date} value={justificationForm.endDate} onChange={e => setJustificationForm({ ...justificationForm, endDate: e.target.value })} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-black text-xs outline-none focus:ring-2 focus:ring-indigo-500"/>
                      </label>
                    )}
                  </div>

                  {/* Atalhos Rápidos de Período para Férias */}
                  {justificationForm.type === 'VACATION' && (
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
                      <div>
                        <span className="text-[10px] font-black uppercase text-emerald-900 block mb-0.5">Duração das Férias:</span>
                        <p className="text-xs font-bold text-emerald-950">
                          🌴 De <span className="underline">{safeFormatDate(justificationForm.date)}</span> até <span className="underline">{safeFormatDate(justificationForm.endDate)}</span> (
                          <strong className="text-emerald-700 font-black">
                            {Math.max(1, Math.round((new Date(justificationForm.endDate + 'T12:00:00').getTime() - new Date(justificationForm.date + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)) + 1)} dias
                          </strong>)
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-black uppercase text-emerald-800 mr-1">Atalhos:</span>
                        {[10, 15, 20, 30].map(days => (
                          <button
                            key={days}
                            type="button"
                            onClick={() => {
                              const d = new Date(justificationForm.date + 'T12:00:00');
                              d.setDate(d.getDate() + days - 1);
                              setJustificationForm(prev => ({ ...prev, endDate: getLocalDateString(d) }));
                            }}
                            className="px-3 py-1.5 rounded-xl bg-white border border-emerald-300 text-emerald-900 text-xs font-black hover:bg-emerald-600 hover:text-white transition-all shadow-sm active:scale-95"
                          >
                            +{days} Dias
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Campos específicos para Evento Externo */}
                  {justificationForm.type === 'WORK_EXTERNAL' && (
                    <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-indigo-800">Horário Início do Evento</span>
                        <input type="time" value={justificationForm.startTime} onChange={e => setJustificationForm({ ...justificationForm, startTime: e.target.value })} className="w-full p-3 rounded-xl bg-white border border-indigo-200 font-mono font-bold text-xs"/>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-indigo-800">Horário Término do Evento</span>
                        <input type="time" value={justificationForm.endTime} onChange={e => setJustificationForm({ ...justificationForm, endTime: e.target.value })} className="w-full p-3 rounded-xl bg-white border border-indigo-200 font-mono font-bold text-xs"/>
                      </label>
                    </div>
                  )}

                  {/* Opção Feriado Trabalhado Regra Petrópolis */}
                  {justificationForm.type === 'HOLIDAY' && (
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                      <span className="text-[10px] font-black uppercase text-amber-900">Como o colaborador escolheu receber o feriado?</span>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                          <input type="radio" name="comp" checked={justificationForm.holidayCompensation === 'HALF_HALF'} onChange={() => setJustificationForm({ ...justificationForm, holidayCompensation: 'HALF_HALF' })}/>
                          <span>Meio a Meio: +1 Folga no Banco (+8h) + Diária Paga no Dia (Padrão)</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                          <input type="radio" name="comp" checked={justificationForm.holidayCompensation === 'TWO_DAYS_OFF'} onChange={() => setJustificationForm({ ...justificationForm, holidayCompensation: 'TWO_DAYS_OFF' })}/>
                          <span>2 Folgas Integrais (+16h no Banco de Horas)</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                          <input type="radio" name="comp" checked={justificationForm.holidayCompensation === 'PAID'} onChange={() => setJustificationForm({ ...justificationForm, holidayCompensation: 'PAID' })}/>
                          <span>Pagamento 100% em Folha (Sem folgas no banco)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase text-slate-400">Observação / Nome do Evento</span>
                    <input value={justificationForm.note} onChange={e => setJustificationForm({ ...justificationForm, note: e.target.value })} placeholder="Ex: Feira de Negócios / Atestado Dr. Silva" className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </label>

                  <button type="submit" disabled={isSaving} className="py-3 px-6 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider shadow-md hover:bg-indigo-700 transition-all flex items-center gap-2">
                    {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <CheckCircle2 size={14}/>} Confirmar Lançamento
                  </button>
                </form>
              </div>

              {/* Lista de Justificativas e Lançamentos */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Histórico de Lançamentos</h3>
                  <ShieldCheck size={16} className="text-slate-300"/>
                </div>
                <div className="divide-y divide-slate-100">
                  {data.timeBank.filter(t => t.type !== 'WORK').map(t => {
                    const emp = data.employees.find(e => e.id === t.employeeId);
                    return (
                      <div key={t.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-all">
                        <div>
                          <p className="font-bold text-xs text-slate-800">{emp?.name || '---'} • <span className="text-indigo-600 font-black">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]}</span></p>
                          <p className="text-[10px] text-slate-400">{safeFormatDate(t.date)} {t.note ? `• ${t.note}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold text-xs ${t.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(t.minutes)}</span>
                          <button onClick={() => handleDeleteEntry(t.id, "Deseja excluir este lançamento?")} className="p-1.5 text-slate-300 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all">
                            <Trash2 size={14}/>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB: RELATÓRIOS & EDIÇÃO DE PONTO */}
          {activeTab === 'reports' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full md:w-auto">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-slate-400">Data Inicial</span>
                    <input type="date" value={reportFilter.startDate} onChange={e => setReportFilter({ ...reportFilter, startDate: e.target.value })} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs"/>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-slate-400">Data Final</span>
                    <input type="date" value={reportFilter.endDate} onChange={e => setReportFilter({ ...reportFilter, endDate: e.target.value })} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs"/>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-slate-400">Colaborador</span>
                    <select value={reportFilter.employeeId} onChange={e => setReportFilter({ ...reportFilter, employeeId: e.target.value })} className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs">
                      <option value="all">Todos os colaboradores</option>
                      {data.employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={openCreateClockModal} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                    <Plus size={14}/> Incluir Ponto
                  </button>
                  <button onClick={handleExportAccountantReport} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                    <Download size={14}/> Exportar CSV
                  </button>
                </div>
              </div>

              {/* Tabela de Registros */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-bold">
                    <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-400">
                      <tr>
                        <th className="px-6 py-4">Data</th>
                        <th className="px-6 py-4">Colaborador</th>
                        <th className="px-6 py-4 text-center">Horário E/S</th>
                        <th className="px-6 py-4 text-center">Saldo Diário</th>
                        <th className="px-6 py-4 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRecords.map(r => {
                        const emp = data.employees.find(e => e.id === r.employeeId);
                        const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
                        return (
                          <tr key={r.id} className="hover:bg-slate-50/50 transition-all">
                            <td className="px-6 py-4 font-mono text-slate-500">{safeFormatDate(r.date)}</td>
                            <td className="px-6 py-4">{emp?.name || '---'}</td>
                            <td className="px-6 py-4 text-center font-mono">{formatTime(r.clockIn)} - {formatTime(r.clockOut)}</td>
                            <td className={`px-6 py-4 text-center font-mono ${tbe && tbe.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{tbe ? formatMinutes(tbe.minutes) : '---'}</td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button title="Corrigir horários" onClick={() => openClockEditor(r)} className="p-2 text-indigo-300 hover:text-indigo-600"><Edit2 size={16}/></button>
                                <button title="Excluir ponto" onClick={() => handleDeleteFullRecord(r.id, r.employeeId, r.date)} className="p-2 text-rose-300 hover:text-rose-600"><Trash2 size={16}/></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ADMIN (CONFIGURAÇÕES) */}
          {activeTab === 'admin' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 max-w-xl">
                <h3 className="text-xl font-black font-serif italic mb-2">Ajuste de PIN de Gerência</h3>
                <p className="text-xs text-slate-400 mb-6">Altere a senha numérica de 4 dígitos para acesso aos módulos gerenciais.</p>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!supabase) return;
                  try {
                    const newPin = (e.target as any).pin.value;
                    if (newPin.length !== 4) return alert("O PIN deve ter 4 dígitos");
                    await supabase.from('settings').upsert({ id: 1, managerPin: newPin });
                    alert("PIN atualizado com sucesso!");
                    await fetchData();
                  } catch (err: any) { alert("Erro: " + err.message); }
                }} className="space-y-4">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase text-slate-400">Novo PIN (4 dígitos)</span>
                    <input name="pin" type="password" maxLength={4} defaultValue={data.settings?.managerPin || "1234"} className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono font-bold text-center text-lg outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </label>
                  <button type="submit" className="py-3 px-6 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider shadow-md hover:bg-indigo-700 transition-all">Salvar Novo PIN</button>
                </form>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* MODAL AUTODECLARAÇÃO: ESQUECI DE BATER ENTRADA */}
      {isSelfDeclareModalOpen && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
          <form onSubmit={handleSaveSelfDeclaration} className="bg-white text-slate-800 w-full max-w-lg p-7 md:p-9 rounded-[2.5rem] shadow-2xl relative">
            <button
              type="button"
              onClick={() => { setIsSelfDeclareModalOpen(false); setSelfDeclareEmployeeId(null); }}
              disabled={isSaving}
              className="absolute top-6 right-6 text-slate-300 hover:text-slate-900 disabled:opacity-40"
            >
              <X size={24}/>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                <ClockIcon size={24}/>
              </div>
              <div>
                <h2 className="text-2xl font-black font-serif italic text-slate-900">Informar Chegada</h2>
                <p className="text-xs font-bold text-slate-400">
                  {data.employees.find(e => e.id === selfDeclareEmployeeId)?.name} • {safeFormatDate(getLocalDateString(currentTime))}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Informe o horário exato em que você chegou na loja hoje. Este registro será gravado com o timestamp de confirmação para segurança mútua.
            </p>

            {/* Atalhos Rápidos */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setSelfDeclareTime('10:00')}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-all ${selfDeclareTime === '10:00' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                10:00 (Abertura)
              </button>
              <button
                type="button"
                onClick={() => setSelfDeclareTime('14:30')}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-all ${selfDeclareTime === '14:30' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                14:30 (Turno Tarde)
              </button>
            </div>

            <div className="space-y-4">
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase text-slate-400">Horário Exato de Entrada *</span>
                <input
                  type="time"
                  required
                  value={selfDeclareTime}
                  onChange={e => setSelfDeclareTime(e.target.value)}
                  className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-200 font-mono font-black text-lg text-center outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase text-slate-400">Motivo (Opcional)</span>
                <input
                  type="text"
                  placeholder="Ex: Esqueci de registrar ao abrir a loja"
                  value={selfDeclareNote}
                  onChange={e => setSelfDeclareNote(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setIsSelfDeclareModalOpen(false); setSelfDeclareEmployeeId(null); }}
                disabled={isSaving}
                className="flex-1 py-3.5 rounded-xl bg-slate-100 text-slate-500 font-black uppercase text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-60 transition-all"
              >
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} Confirmar Entrada
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL EDIÇÃO MANUAL DE PONTO (GERENTE) */}
      {(editingClockRecord || creatingClockRecord) && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
          <form onSubmit={handleSaveClockEdit} className="bg-white text-slate-800 w-full max-w-2xl p-7 md:p-9 rounded-[2rem] shadow-2xl relative">
            <button type="button" onClick={closeClockEditor} disabled={isSaving} className="absolute top-6 right-6 text-slate-300 hover:text-slate-900 disabled:opacity-40"><X size={24}/></button>
            <div className="pr-10 mb-6">
              <h2 className="text-2xl font-black font-serif italic">{editingClockRecord ? 'Corrigir batidas' : 'Incluir ponto'}</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">
                {editingClockRecord
                  ? `${data.employees.find(emp => emp.id === editingClockRecord.employeeId)?.name} • ${safeFormatDate(editingClockRecord.date)}`
                  : 'Cadastre os horários informados pelo funcionário.'}
              </p>
            </div>

            {creatingClockRecord && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-emerald-700">Colaborador *</span>
                  <select
                    required
                    value={creatingClockRecord.employeeId}
                    onChange={event => setCreatingClockRecord(current => current ? ({ ...current, employeeId: event.target.value }) : current)}
                    className="w-full p-3 rounded-xl bg-white border border-emerald-100 font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione...</option>
                    {data.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-emerald-700">Data *</span>
                  <input
                    type="date"
                    required
                    max={getLocalDateString(new Date())}
                    value={creatingClockRecord.date}
                    onChange={event => setCreatingClockRecord(current => current ? ({ ...current, date: event.target.value }) : current)}
                    className="w-full p-3 rounded-xl bg-white border border-emerald-100 font-black outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                ['clockIn', 'Entrada', true],
                ['lunchStart', 'Início do almoço', false],
                ['lunchEnd', 'Retorno do almoço', false],
                ['snackStart', 'Início do lanche', false],
                ['snackEnd', 'Retorno do lanche', false],
                ['clockOut', 'Saída final', true]
              ] as [keyof ClockEditForm, string, boolean][]).map(([field, label, required]) => (
                <label key={field} className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-slate-400">{label}{required ? ' *' : ''}</span>
                  <input
                    type="time"
                    required={required}
                    value={clockEditForm[field]}
                    onChange={event => setClockEditForm(current => ({ ...current, [field]: event.target.value }))}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono font-black outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={closeClockEditor} disabled={isSaving} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-500 font-black uppercase text-xs disabled:opacity-40">Cancelar</button>
              <button type="submit" disabled={isSaving} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-60">
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} {editingClockRecord ? 'Salvar correção' : 'Incluir ponto'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL PIN */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-md">
           <div className="bg-white w-full max-w-[340px] p-10 rounded-[3rem] shadow-2xl relative text-center">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-8 right-8 text-slate-300 hover:text-slate-900"><X size={24}/></button>
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner"><Lock size={32}/></div>
              <h2 className="text-2xl font-black font-serif italic mb-1">Acesso Gerente</h2>
              <div className="flex justify-center gap-4 my-8">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-3 h-3 rounded-full ${pinInput.length > i ? 'bg-indigo-600 scale-125' : 'bg-slate-200'} ${loginError ? 'bg-rose-500' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-14 rounded-xl font-black text-xl bg-slate-50 hover:bg-indigo-600 hover:text-white transition-all">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}

      {/* MODAL REGRAS CLT & DIREITOS DE PONTO */}
      {isCltModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white text-slate-800 w-full max-w-3xl p-6 md:p-10 rounded-[2.5rem] shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setIsCltModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 p-2 rounded-full hover:bg-slate-100 transition-all"
            >
              <X size={24}/>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black">
                <BookOpen size={24}/>
              </div>
              <div>
                <h2 className="text-2xl font-black font-serif italic text-slate-900">Regras da CLT & Direitos de Ponto</h2>
                <p className="text-xs font-bold text-slate-400">Guia de transparência e direitos para os colaboradores</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <h3 className="font-black text-slate-900 flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 font-mono">01.</span> Tolerância de Ponto (Art. 58, § 1º da CLT & Súmula 366 TST)
                </h3>
                <p className="text-slate-600 leading-relaxed font-normal">
                  Variações de <strong>até 5 minutos</strong> por batida (e até <strong>10 minutos no total do dia</strong>) não são descontadas e nem computadas como hora extra. 
                  Se a variação ultrapassar 5 minutos ou o total do dia passar de 10 minutos, o tempo total é computado como hora extra ou hora devida.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <h3 className="font-black text-slate-900 flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 font-mono">02.</span> Intervalo de Almoço (Art. 71 da CLT)
                </h3>
                <p className="text-slate-600 leading-relaxed font-normal">
                  Para jornadas de 8 horas diárias, o intervalo para refeição e descanso é de <strong>no mínimo 1 hora</strong>. O intervalo de almoço não é computado na jornada de trabalho.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100">
                <h3 className="font-black text-indigo-900 flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 font-mono">03.</span> Pausa para Lanche (Benefício Concedido pela Empresa)
                </h3>
                <p className="text-indigo-950/80 leading-relaxed font-normal">
                  A empresa concede uma pausa de <strong>até 15 minutos</strong> para café/lanche como benefício aos colaboradores. 
                  Essa pausa de até 15 min <strong>não é descontada</strong> da sua jornada de 8h. Apenas minutos que excederem os 15 minutos serão deduzidos no banco de horas.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <h3 className="font-black text-slate-900 flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 font-mono">04.</span> Descanso Entre Dias de Trabalho (Art. 66 da CLT)
                </h3>
                <p className="text-slate-600 leading-relaxed font-normal">
                  Entre o encerramento do expediente de um dia e o início da jornada do dia seguinte, deve haver um período mínimo de <strong>11 horas consecutivas</strong> de descanso.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <h3 className="font-black text-slate-900 flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 font-mono">05.</span> Feriados Trabalhados (Acordo de Petrópolis)
                </h3>
                <p className="text-slate-600 leading-relaxed font-normal">
                  Feriados trabalhados garantem compensação com <strong>folga integral (+8h)</strong> e pagamento conforme a convenção coletiva local.
                </p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider transition-all"
              >
                <Download size={14}/>
                <span>Imprimir Este Guia</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCltModalOpen(false)}
                className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-200"
              >
                Entendi e Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
