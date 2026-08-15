import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { AppData, Employee, ClockRecord, TimeBankEntry, EntryType, Holiday, QueueAttendance, RiserCoupon, ReconciliationItem } from './types';
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
  Play, Check, SkipForward, Pause, Award, Bell, HelpCircle,
  Star, Smartphone, Copy, RotateCcw, Receipt, CheckSquare, Share2,
  FileSpreadsheet, Upload, CheckCheck, DollarSign, Percent, Zap, Filter
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
  
  // Detecção de Modo Somente Fila (para acesso no celular do vendedor sem acesso ao ponto)
  const isQueueUrlDetected = typeof window !== 'undefined' && (
    window.location.search.includes('view=queue') || 
    window.location.search.includes('fila') || 
    window.location.hash.includes('queue') || 
    window.location.hash.includes('fila')
  );
  const [isQueueOnlyMode, setIsQueueOnlyMode] = useState(isQueueUrlDetected);
  const [activeTab, setActiveTab] = useState(isQueueUrlDetected ? 'queue' : 'clock'); 
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

  // Estados Avançados da Fila da Vez (Vendas & Rodízio)
  const [activeAttendances, setActiveAttendances] = useState<Record<string, {
    id: string;
    employeeId: string;
    startedAt: string;
    startedTimestamp: number;
    type: 'NORMAL' | 'DIRECT';
    originalPosition?: number;
  }>>(() => {
    try {
      const today = getLocalDateString(new Date());
      const stored = localStorage.getItem(`ponto_active_attendances_v2_${today}`);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  });

  const [todayAttendances, setTodayAttendances] = useState<QueueAttendance[]>(() => {
    try {
      const today = getLocalDateString(new Date());
      const stored = localStorage.getItem(`ponto_attendances_v2_${today}`);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  const [customQueueOrder, setCustomQueueOrder] = useState<string[]>(() => {
    try {
      const today = getLocalDateString(new Date());
      const stored = localStorage.getItem(`ponto_queue_order_v2_${today}`);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  // Modais de Fila (Finalização de Atendimento com Cupom & Compartilhar Link Mobile)
  const [finishingAttendance, setFinishingAttendance] = useState<{
    employeeId: string;
    startedAt: string;
    startedTimestamp: number;
    type: 'NORMAL' | 'DIRECT';
  } | null>(null);
  const [finishSaleNote, setFinishSaleNote] = useState('');
  const [isShareQueueModalOpen, setIsShareQueueModalOpen] = useState(false);
  const [copiedLinkFeedback, setCopiedLinkFeedback] = useState(false);

  // Estados da Conciliação Automática de Cupons do Riser
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [reconcileTab, setReconcileTab] = useState<'upload' | 'paste' | 'results'>('upload');
  const [rawPastedText, setRawPastedText] = useState('');
  const [reconcileToleranceMin, setReconcileToleranceMin] = useState(15);
  const [importedCoupons, setImportedCoupons] = useState<RiserCoupon[]>([]);
  const [reconciledItems, setReconciledItems] = useState<ReconciliationItem[]>([]);
  const [unmatchedCoupons, setUnmatchedCoupons] = useState<RiserCoupon[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [reconcileAppliedFeedback, setReconcileAppliedFeedback] = useState(false);

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

  // Efeitos de persistência local da Fila e Atendimentos do Dia
  useEffect(() => {
    const today = getLocalDateString(currentTime);
    try {
      localStorage.setItem(`ponto_active_attendances_v2_${today}`, JSON.stringify(activeAttendances));
    } catch (e) {}
  }, [activeAttendances, currentTime]);

  useEffect(() => {
    const today = getLocalDateString(currentTime);
    try {
      localStorage.setItem(`ponto_attendances_v2_${today}`, JSON.stringify(todayAttendances));
    } catch (e) {}
  }, [todayAttendances, currentTime]);

  useEffect(() => {
    const today = getLocalDateString(currentTime);
    try {
      localStorage.setItem(`ponto_queue_order_v2_${today}`, JSON.stringify(customQueueOrder));
    } catch (e) {}
  }, [customQueueOrder, currentTime]);

  // Fila da Vez: Vendedores presentes hoje ordenados por ordem de chegada no ponto
  const salesQueue = useMemo(() => {
    const todayStr = getLocalDateString(currentTime);
    const salesEmployees = data.employees.filter(e => e.isActive !== false && e.isSalesperson !== false);
    const todayRecords = data.records.filter(r => r.date === todayStr);

    const currentlyAttending: {
      employee: Employee;
      record?: ClockRecord;
      attendance: {
        id: string;
        employeeId: string;
        startedAt: string;
        startedTimestamp: number;
        type: 'NORMAL' | 'DIRECT';
        originalPosition?: number;
      };
    }[] = [];

    const waitingList: {
      employee: Employee;
      record?: ClockRecord;
      orderKey: number;
    }[] = [];

    const inBreak: {
      employee: Employee;
      record?: ClockRecord;
      status: 'IN_LUNCH' | 'IN_SNACK';
    }[] = [];

    const others: {
      employee: Employee;
      record?: ClockRecord;
      status: 'LEFT' | 'NOT_ARRIVED';
    }[] = [];

    salesEmployees.forEach(emp => {
      const rec = todayRecords.find(r => r.employeeId === emp.id);
      const activeAtt = activeAttendances[emp.id];

      if (!rec || !rec.clockIn) {
        others.push({ employee: emp, record: rec, status: 'NOT_ARRIVED' });
      } else if (rec.clockOut) {
        others.push({ employee: emp, record: rec, status: 'LEFT' });
      } else if (rec.snackStart && !rec.snackEnd) {
        inBreak.push({ employee: emp, record: rec, status: 'IN_SNACK' });
      } else if (rec.lunchStart && !rec.lunchEnd) {
        inBreak.push({ employee: emp, record: rec, status: 'IN_LUNCH' });
      } else if (activeAtt) {
        currentlyAttending.push({ employee: emp, record: rec, attendance: activeAtt });
      } else {
        const customIdx = customQueueOrder.indexOf(emp.id);
        const clockTime = new Date(rec.clockIn).getTime();
        const baseKey = customIdx !== -1 ? customIdx : clockTime;
        waitingList.push({ employee: emp, record: rec, orderKey: baseKey });
      }
    });

    const waitingSorted = waitingList.sort((a, b) => a.orderKey - b.orderKey);

    return { 
      waitingQueue: waitingSorted, 
      currentlyAttending, 
      inBreak, 
      others 
    };
  }, [data.employees, data.records, currentTime, activeAttendances, customQueueOrder]);

  // Estatísticas e Balanço Diário de Atendimentos + Alerta de Atendimentos Consecutivos
  const attendanceStats = useMemo(() => {
    const completedToday = todayAttendances.filter(a => a.status === 'COMPLETED');
    const counts: Record<string, { total: number; normal: number; direct: number; totalMinutes: number }> = {};
    let grandTotalMinutes = 0;

    completedToday.forEach(a => {
      if (!counts[a.employeeId]) {
        counts[a.employeeId] = { total: 0, normal: 0, direct: 0, totalMinutes: 0 };
      }
      counts[a.employeeId].total += 1;
      if (a.type === 'DIRECT') {
        counts[a.employeeId].direct += 1;
      } else {
        counts[a.employeeId].normal += 1;
      }
      const dur = a.durationMinutes || 0;
      counts[a.employeeId].totalMinutes += dur;
      grandTotalMinutes += dur;
    });

    const totalAttendances = completedToday.length;
    const totalNormal = completedToday.filter(a => a.type === 'NORMAL').length;
    const totalDirect = completedToday.filter(a => a.type === 'DIRECT').length;
    const avgDuration = totalAttendances > 0 ? Math.round(grandTotalMinutes / totalAttendances) : 0;

    // Alerta de Atendimentos Consecutivos (Suspeita de Furar Fila)
    let consecutiveAlert: { employeeName: string; count: number } | null = null;
    if (completedToday.length >= 3) {
      const lastEmpId = completedToday[completedToday.length - 1].employeeId;
      let seq = 0;
      for (let i = completedToday.length - 1; i >= 0; i--) {
        if (completedToday[i].employeeId === lastEmpId) {
          seq++;
        } else {
          break;
        }
      }
      if (seq >= 3) {
        const emp = data.employees.find(e => e.id === lastEmpId);
        consecutiveAlert = {
          employeeName: emp ? emp.name.split(' ')[0] : 'Vendedor',
          count: seq
        };
      }
    }

    return {
      counts,
      completedToday,
      totalAttendances,
      totalNormal,
      totalDirect,
      avgDuration,
      consecutiveAlert
    };
  }, [todayAttendances, data.employees]);

  // Iniciar Atendimento (Vez da Fila ou Cliente Fidelizado)
  const handleStartAttendance = (employeeId: string, type: 'NORMAL' | 'DIRECT' = 'NORMAL') => {
    const currentPos = salesQueue.waitingQueue.findIndex(q => q.employee.id === employeeId);
    const now = new Date();
    const startedAt = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    const item = {
      id: generateId(),
      employeeId,
      startedAt,
      startedTimestamp: Date.now(),
      type,
      originalPosition: currentPos >= 0 ? currentPos : undefined
    };

    setActiveAttendances(prev => ({ ...prev, [employeeId]: item }));
  };

  // Cancelar Atendimento acidental (devolve à posição original sem prejuízo)
  const handleCancelAttendance = (employeeId: string) => {
    if (confirm("Deseja cancelar este atendimento e retornar o vendedor à sua posição na fila?")) {
      setActiveAttendances(prev => {
        const copy = { ...prev };
        delete copy[employeeId];
        return copy;
      });
    }
  };

  // Abrir Modal de Finalização (com cupom/obs opcional)
  const handleOpenFinishAttendance = (employeeId: string) => {
    const item = activeAttendances[employeeId];
    if (!item) return;
    setFinishingAttendance(item);
    setFinishSaleNote('');
  };

  // Finalizar Atendimento e Mover Colaborador para o Fim da Fila
  const handleCompleteAttendance = (employeeId: string, saleNote?: string) => {
    const item = activeAttendances[employeeId] || (finishingAttendance?.employeeId === employeeId ? finishingAttendance : null);
    if (!item) return;

    const now = new Date();
    const endedAt = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const diffMinutes = Math.max(1, Math.round((Date.now() - item.startedTimestamp) / 60000));
    const todayStr = getLocalDateString(currentTime);

    const completedRecord: QueueAttendance = {
      id: item.id || generateId(),
      employeeId,
      date: todayStr,
      startedAt: item.startedAt,
      endedAt,
      durationMinutes: diffMinutes,
      type: item.type,
      status: 'COMPLETED',
      saleNote: (saleNote || finishSaleNote).trim() || undefined
    };

    setTodayAttendances(prev => [...prev, completedRecord]);

    // Remover de atendimentos ativos
    setActiveAttendances(prev => {
      const copy = { ...prev };
      delete copy[employeeId];
      return copy;
    });

    // Mover vendedor para o FINAL da fila de espera
    setCustomQueueOrder(prev => {
      const currentWaitingIds = salesQueue.waitingQueue.map(q => q.employee.id);
      const filtered = currentWaitingIds.filter(id => id !== employeeId);
      return [...filtered, employeeId];
    });

    setFinishingAttendance(null);
    setFinishSaleNote('');
  };

  // Atualizar Nº do Cupom / Obs de um atendimento no Balanço
  const handleUpdateAttendanceSaleNote = (attendanceId: string, note: string) => {
    setTodayAttendances(prev => prev.map(att => att.id === attendanceId ? { ...att, saleNote: note.trim() || undefined } : att));
  };

  // Parser inteligente de matriz de dados do Riser (Excel ou Copiado/Colado)
  const parseRiserMatrix = (matrix: any[][]): RiserCoupon[] => {
    const coupons: RiserCoupon[] = [];
    if (!matrix || matrix.length === 0) return coupons;

    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};

    for (let r = 0; r < Math.min(10, matrix.length); r++) {
      const row = matrix[r].map(c => String(c || '').toLowerCase().trim());
      if (row.some(c => c.includes('cupom') || c.includes('data/hora') || c.includes('data') || c.includes('valor'))) {
        headerRowIdx = r;
        row.forEach((colName, cIdx) => {
          if (colName.includes('data') || colName.includes('hora')) colMap['date'] = cIdx;
          if (colName === 'cupom' || colName.includes('cupom')) colMap['cupom'] = cIdx;
          if (colName === 'tipo' || colName.includes('tipo')) colMap['tipo'] = cIdx;
          if (colName === 'valor' || colName.includes('valor') || colName.includes('total')) colMap['valor'] = cIdx;
          if (colName === 'pdv' || colName.includes('pdv') || colName.includes('caixa')) colMap['pdv'] = cIdx;
          if (colName === 'operador' || colName.includes('operador')) colMap['operador'] = cIdx;
          if (colName === 'status' || colName.includes('status')) colMap['status'] = cIdx;
        });
        break;
      }
    }

    const startIdx = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

    for (let r = startIdx; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row || row.length === 0) continue;

      let dateStr = '';
      let cupomStr = '';
      let tipoStr = '';
      let valorNum = 0;
      let pdvStr = '';
      let operadorStr = '';
      let statusStr = '';

      if (colMap['date'] !== undefined) dateStr = String(row[colMap['date']] || '');
      if (colMap['cupom'] !== undefined) cupomStr = String(row[colMap['cupom']] || '');
      if (colMap['tipo'] !== undefined) tipoStr = String(row[colMap['tipo']] || '');
      if (colMap['valor'] !== undefined) {
        const vRaw = String(row[colMap['valor']] || '').replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        valorNum = parseFloat(vRaw) || 0;
      }
      if (colMap['pdv'] !== undefined) pdvStr = String(row[colMap['pdv']] || '');
      if (colMap['operador'] !== undefined) operadorStr = String(row[colMap['operador']] || '');
      if (colMap['status'] !== undefined) statusStr = String(row[colMap['status']] || '');

      // Fallback: detecção de padrão por coluna se o cabeçalho não tiver sido mapeado
      if (!dateStr || !cupomStr) {
        row.forEach(cell => {
          const val = String(cell || '').trim();
          if (/\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/.test(val) || /\d{1,2}:\d{2}:\d{2}/.test(val)) {
            dateStr = val;
          } else if (/^\d{4,8}$/.test(val) && !cupomStr) {
            cupomStr = val;
          } else if (/venda|abertura|cancel|troca|contra-vale/i.test(val) && !tipoStr) {
            tipoStr = val;
          } else if (/\d+[,.]\d{2}/.test(val) && !valorNum) {
            const vRaw = val.replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
            valorNum = parseFloat(vRaw) || 0;
          }
        });
      }

      // Filtrar apenas linhas de venda (ignorar aberturas de caixa, contra-vales, sangrias)
      const isSale = tipoStr.toLowerCase().includes('venda') || (!tipoStr && valorNum > 0);
      const isIgnored = /abertura|contra-vale|sangria|suprimento/i.test(tipoStr) || /contra-vale/i.test(statusStr);

      if (isSale && !isIgnored && valorNum > 0) {
        let timeStr = '10:00:00';
        const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeMatch) {
          timeStr = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2].padStart(2, '0')}:${timeMatch[3] ? timeMatch[3].padStart(2, '0') : '00'}`;
        }

        const [thH, thM, thS] = timeStr.split(':').map(Number);
        const couponDate = new Date(currentTime);
        couponDate.setHours(thH, thM, thS || 0, 0);

        coupons.push({
          id: `cp_${r}_${cupomStr || Date.now()}`,
          dateTimeStr: dateStr || timeStr,
          timeStr,
          timestamp: couponDate.getTime(),
          cupom: cupomStr || `Cupom #${r}`,
          tipo: tipoStr || 'Venda',
          valor: valorNum,
          pdv: pdvStr || undefined,
          operador: operadorStr || undefined,
          status: statusStr || 'Cupom encerrado'
        });
      }
    }

    return coupons;
  };

  // Executar algoritmo de matching cronológico
  const executeReconciliation = (coupons: RiserCoupon[], toleranceMinutes: number = reconcileToleranceMin) => {
    const completed = todayAttendances.filter(a => a.status === 'COMPLETED');
    const availableCoupons = [...coupons].sort((a, b) => a.timestamp - b.timestamp);
    const matched: ReconciliationItem[] = [];
    const usedCouponIndexes = new Set<number>();

    completed.forEach(att => {
      const emp = data.employees.find(e => e.id === att.employeeId);
      const empName = emp?.name || 'Vendedor';

      const [sH, sM] = att.startedAt.split(':').map(Number);
      const [eH, eM] = (att.endedAt || att.startedAt).split(':').map(Number);

      const startDate = new Date(currentTime);
      startDate.setHours(sH, sM, 0, 0);
      const startTs = startDate.getTime();

      const endDate = new Date(currentTime);
      endDate.setHours(eH, eM, 59, 999);
      const endTs = endDate.getTime();

      const maxToleranceTs = endTs + (toleranceMinutes * 60 * 1000);

      let bestCouponIdx = -1;
      let minDiff = Infinity;

      availableCoupons.forEach((cp, idx) => {
        if (usedCouponIndexes.has(idx)) return;
        // Cupom emitido a partir de 2 min antes do início do atendimento até toleranceMinutes após o fim
        if (cp.timestamp >= startTs - (2 * 60 * 1000) && cp.timestamp <= maxToleranceTs) {
          const diff = Math.abs(cp.timestamp - endTs);
          if (diff < minDiff) {
            minDiff = diff;
            bestCouponIdx = idx;
          }
        }
      });

      if (bestCouponIdx !== -1) {
        usedCouponIndexes.add(bestCouponIdx);
        const cp = availableCoupons[bestCouponIdx];
        const diffMin = Math.round((cp.timestamp - endTs) / 60000);
        matched.push({
          attendance: att,
          employeeName: empName,
          matchedCoupon: cp,
          timeDiffMinutes: diffMin,
          status: 'MATCHED'
        });
      } else {
        matched.push({
          attendance: att,
          employeeName: empName,
          status: 'NO_SALE'
        });
      }
    });

    const unmatched = availableCoupons.filter((_, idx) => !usedCouponIndexes.has(idx));
    setImportedCoupons(coupons);
    setReconciledItems(matched);
    setUnmatchedCoupons(unmatched);
    setReconcileTab('results');
  };

  // Handler de upload de arquivo Excel / CSV
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingFile(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        const parsedCoupons = parseRiserMatrix(jsonRows);
        if (parsedCoupons.length === 0) {
          alert("Nenhum cupom de venda encontrado no arquivo. Verifique se o arquivo contém as colunas Data/Hora, Cupom e Valor.");
          return;
        }
        executeReconciliation(parsedCoupons, reconcileToleranceMin);
      } catch (err: any) {
        alert("Erro ao ler arquivo: " + err.message);
      } finally {
        setIsProcessingFile(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Handler para dados colados
  const handleProcessPastedText = () => {
    if (!rawPastedText.trim()) {
      alert("Por favor, cole os dados do relatório do Riser na caixa de texto.");
      return;
    }
    setIsProcessingFile(true);
    try {
      const lines = rawPastedText.trim().split('\n');
      const rows = lines.map(line => {
        if (line.includes('\t')) return line.split('\t');
        if (line.includes(';')) return line.split(';');
        return line.split(/ {2,}/);
      });
      const parsedCoupons = parseRiserMatrix(rows);
      if (parsedCoupons.length === 0) {
        alert("Nenhum cupom de venda reconhecido no texto colado. Certifique-se de copiar a tabela de cupons do Riser.");
        return;
      }
      executeReconciliation(parsedCoupons, reconcileToleranceMin);
    } catch (err: any) {
      alert("Erro ao processar texto: " + err.message);
    } finally {
      setIsProcessingFile(false);
    }
  };

  // Aplicar resultados conciliados no Balanço Diário
  const handleApplyReconciliation = () => {
    const todayStr = getLocalDateString(currentTime);
    setTodayAttendances(prev => {
      const updated = prev.map(att => {
        const match = reconciledItems.find(r => r.attendance.id === att.id);
        if (match && match.status === 'MATCHED' && match.matchedCoupon) {
          return {
            ...att,
            saleNote: `Cupom ${match.matchedCoupon.cupom}${match.matchedCoupon.pdv ? ` (PDV ${match.matchedCoupon.pdv})` : ''}`,
            saleAmount: match.matchedCoupon.valor
          };
        }
        return att;
      });
      try {
        localStorage.setItem(`ponto_attendances_v2_${todayStr}`, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    setReconcileAppliedFeedback(true);
    setTimeout(() => {
      setReconcileAppliedFeedback(false);
      setIsReconcileModalOpen(false);
    }, 1200);
  };

  // Passar a vez caso o colaborador precise ir para o fim da fila sem registrar atendimento
  const handlePassTurn = (employeeId: string) => {
    setCustomQueueOrder(prev => {
      const currentWaitingIds = salesQueue.waitingQueue.map(q => q.employee.id);
      const index = currentWaitingIds.indexOf(employeeId);
      if (index === -1 || currentWaitingIds.length <= 1) return currentWaitingIds;
      const reordered = [...currentWaitingIds];
      const [moved] = reordered.splice(index, 1);
      reordered.push(moved);
      return reordered;
    });
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
    if (!record?.clockIn) return { label: 'Entrada', stage: 'in', color: 'bg-zinc-950 text-amber-400 hover:bg-zinc-900 border-2 border-amber-400/40 shadow-amber-400/10', icon: <LogIn size={20}/> };
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

  const TAB_INFOS: Record<string, { title: string; subtitle: string }> = {
    clock: { title: 'Registro de Ponto', subtitle: 'Toque no seu nome para registrar entrada, pausas ou saída' },
    queue: { title: 'Fila da Vez (Vendas)', subtitle: 'Rodízio de atendimento em loja por ordem de chegada no ponto' },
    dashboard: { title: 'Painel Geral & Saldos', subtitle: 'Visão em tempo real da equipe e do banco de horas' },
    employees: { title: 'Gestão da Equipe', subtitle: 'Contratos, jornadas diárias e semana inglesa' },
    holidays: { title: 'Calendário de Feriados', subtitle: 'Feriados municipais e nacionais com regras de compensação' },
    justifications: { title: 'Justificativas & Atestados', subtitle: 'Lançamento de atestados, férias e eventos externos' },
    admin: { title: 'Ajustes Administrativos', subtitle: 'Correções manuais de batidas e auditoria do banco de horas' },
    reports: { title: 'Relatórios & Espelho de Ponto', subtitle: 'Exportação para contabilidade e fechamento mensal' }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col md:flex-row text-zinc-900 overflow-x-hidden">
      
      {/* SIDEBAR (Identidade Visual Nobel: Preto Nobre & Amarelo Ouro) */}
      {!isQueueOnlyMode && (
        <aside className="w-full md:w-64 bg-[#09090b] text-zinc-100 flex flex-col shadow-2xl md:fixed md:inset-y-0 z-50 overflow-y-auto border-r border-zinc-800/80">
          <div className="p-6 border-b border-zinc-800/60 flex flex-col items-center">
            <div className="bg-gradient-to-br from-amber-400 via-amber-300 to-yellow-500 p-3 rounded-2xl text-zinc-950 shadow-lg shadow-amber-400/20 mb-3 flex items-center justify-center">
              <BookOpen size={26} className="stroke-[2.5]"/>
            </div>
            <span className="text-white font-serif italic text-xl tracking-tight font-black">Livraria Nobel</span>
            <span className="text-[10px] text-amber-400 uppercase font-black tracking-widest mt-0.5">Petrópolis • Ponto & Fila</span>
          </div>
          
          <nav className="flex-1 p-3 space-y-1.5">
            {/* Módulos Públicos da Loja */}
            <button 
              onClick={() => { setActiveTab('clock'); setIsManagerAuthenticated(false); setSelectedClockEmployeeId(null); }} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-black text-xs transition-all ${activeTab === 'clock' && !isManagerAuthenticated ? 'bg-gradient-to-r from-amber-400 to-yellow-400 text-zinc-950 shadow-lg shadow-amber-400/25 scale-[1.02]' : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-900/80'}`}
            >
              <ClockIcon size={18}/> Bater Ponto
            </button>
            <button 
              onClick={() => { setActiveTab('queue'); setIsManagerAuthenticated(false); }} 
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-black text-xs transition-all ${activeTab === 'queue' ? 'bg-gradient-to-r from-amber-400 to-yellow-400 text-zinc-950 shadow-lg shadow-amber-400/25 scale-[1.02]' : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-900/80'}`}
            >
              <Flame size={18}/> Fila da Vez (Vendas)
            </button>

            {/* Módulos de Gestão */}
            <div className="pt-5 pb-1 px-4 text-[9px] font-black uppercase tracking-widest text-zinc-600">Gestão da Loja</div>
            {[
              { id: 'dashboard', label: 'Painel Geral', icon: <TrendingUp size={18}/> },
              { id: 'employees', label: 'Equipe', icon: <Users size={18}/> },
              { id: 'holidays', label: 'Feriados', icon: <CalendarDays size={18}/> },
              { id: 'justifications', label: 'Justificativas', icon: <ShieldCheck size={18}/> },
              { id: 'admin', label: 'Ajustes', icon: <SlidersHorizontal size={18}/> },
              { id: 'reports', label: 'Relatórios', icon: <FileText size={18}/> },
            ].map(item => (
              <button 
                key={item.id} 
                onClick={() => isManagerAuthenticated ? setActiveTab(item.id) : setIsLoginModalOpen(true)} 
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${activeTab === item.id && isManagerAuthenticated ? 'bg-gradient-to-r from-amber-400 to-yellow-400 text-zinc-950 font-black shadow-md shadow-amber-400/20' : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-900/80'}`}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-zinc-800/60 text-center">
            <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest">Sistema Nobel V2.5</span>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT */}
      <main className={`flex-1 p-4 md:p-10 bg-[#f8fafc] text-zinc-900 min-h-screen ${isQueueOnlyMode ? 'max-w-5xl mx-auto' : 'md:ml-64'}`}>
        <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100/80 text-amber-950 text-[10px] font-black uppercase tracking-wider border border-amber-300/60">
                <BookOpen size={11} className="text-amber-700"/> {isQueueOnlyMode ? '📱 Modo Celular (Somente Fila)' : 'Livraria Nobel Petrópolis'}
              </span>
              {isQueueOnlyMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsQueueOnlyMode(false);
                    setActiveTab('clock');
                  }}
                  className="px-2.5 py-0.5 rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-800 text-[9px] font-bold uppercase transition-all"
                >
                  Abrir Terminal Completo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsShareQueueModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-amber-300 text-[9px] font-black uppercase transition-all shadow-sm"
                >
                  <Smartphone size={10}/> Link Celular
                </button>
              )}
            </div>
            <h1 className="text-3xl font-black font-serif italic capitalize leading-none text-zinc-900">
              {TAB_INFOS[activeTab]?.title || activeTab}
            </h1>
            <p className="text-xs text-zinc-400 font-medium mt-1">
              {TAB_INFOS[activeTab]?.subtitle || ''}
            </p>
          </div>
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-zinc-200/80 text-right w-full sm:w-auto">
            <p className="text-xl font-mono font-black text-zinc-900 leading-none tracking-tight">
              {currentTime.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second: '2-digit'})}
            </p>
            <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest block mt-0.5">
              {currentTime.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
            </span>
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
                      <button 
                        key={emp.id} 
                        onClick={() => setSelectedClockEmployeeId(emp.id)} 
                        className={`bg-white p-6 rounded-[2rem] shadow-sm hover:shadow-xl hover:shadow-amber-400/10 transition-all border flex flex-col items-center group relative active:scale-95 ${isPending ? 'border-amber-400/80 ring-2 ring-amber-400/20' : 'border-zinc-200/80 hover:border-amber-400'}`}
                      >
                        {isPending && (
                          <span className="absolute top-3.5 right-3.5 flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                          </span>
                        )}
                        <div className="w-16 h-16 bg-zinc-900 text-amber-400 rounded-2xl flex items-center justify-center text-2xl font-black mb-3 shadow-md group-hover:bg-gradient-to-br group-hover:from-amber-400 group-hover:to-yellow-500 group-hover:text-zinc-950 transition-all">
                          {emp.name.charAt(0)}
                        </div>
                        <span className="font-black text-zinc-900 truncate w-full text-center text-sm">{emp.name.split(' ')[0]}</span>
                        <span className="text-[10px] text-zinc-400 font-bold uppercase truncate w-full text-center mt-0.5">{emp.role || 'Colaborador'}</span>
                        {todayRec?.clockIn && (
                          <span className="mt-2.5 text-[9px] font-mono font-bold text-emerald-800 bg-emerald-100/70 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                            Entrada {formatTime(todayRec.clockIn)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="max-w-3xl mx-auto w-full space-y-6">
                  <button onClick={() => setSelectedClockEmployeeId(null)} className="flex items-center gap-2 text-zinc-500 font-black uppercase text-[10px] hover:text-amber-600 transition-all"><ChevronLeft size={14}/> Voltar para lista</button>
                  {data.employees.filter(e => e.id === selectedClockEmployeeId).map(emp => {
                    const balance = getCumulativeBalance(emp.id);
                    const record = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const action = getNextAction(record);
                    return (
                      <div key={emp.id} className="space-y-6">
                        <div className="bg-white p-8 md:p-12 rounded-[3rem] shadow-xl border border-zinc-200/80 flex flex-col items-center text-center relative overflow-hidden">
                          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-950 text-xs font-black uppercase tracking-wider mb-3">
                            <span>{getGreeting(currentTime).emoji}</span>
                            <span>{getGreeting(currentTime).text}, {emp.name.split(' ')[0]}!</span>
                          </div>
                          <h2 className="text-3xl font-black font-serif italic mb-1 text-zinc-900">{emp.name}</h2>
                          <p className="text-zinc-400 font-bold uppercase text-[10px] mb-4 tracking-widest">{emp.role}</p>
                          
                          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
                            <button
                              type="button"
                              onClick={() => setIsCltModalOpen(true)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-bold transition-all"
                            >
                              <BookOpen size={14} className="text-amber-600"/>
                              <span>Regras CLT & Direitos de Ponto</span>
                            </button>
                          </div>

                          <button 
                            disabled={action.stage === 'done' || clockActionEmployeeId !== null} 
                            onClick={() => handleClockAction(emp.id)} 
                            className={`w-full max-w-md py-9 rounded-[2.5rem] font-black text-2xl shadow-xl transition-all flex items-center justify-center gap-4 ${action.stage === 'in' ? 'bg-zinc-950 hover:bg-zinc-900 text-amber-400 border-2 border-amber-400/40 shadow-amber-400/10' : action.color + ' text-white'} active:scale-95 mb-4 disabled:opacity-60`}
                          >
                            {clockActionEmployeeId === emp.id ? <RefreshCw className="animate-spin" size={22}/> : action.icon} {clockActionEmployeeId === emp.id ? 'Salvando...' : action.label}
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
                              className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-amber-700 text-xs font-bold transition-all py-1 mb-8"
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
                               <div key={idx} className={`p-4 rounded-2xl border transition-all ${t.v ? 'bg-amber-50/60 border-amber-200' : 'bg-zinc-50 border-zinc-100 opacity-50'}`}>
                                  <div className="flex items-center justify-center gap-2 mb-1">
                                    <span className="text-amber-700">{t.i}</span>
                                    <p className="text-[8px] font-black text-zinc-500 uppercase">{t.l}</p>
                                  </div>
                                  <p className="font-mono font-black text-lg text-zinc-900">{formatTime(t.v)}</p>
                               </div>
                             ))}
                          </div>
                        </div>
                        <div className="bg-[#09090b] text-white p-8 rounded-[2.5rem] flex flex-col items-center justify-center shadow-xl text-center relative overflow-hidden border border-zinc-800">
                          <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2 relative z-10">Saldo Acumulado no Banco</p>
                          <p className={`text-5xl font-mono font-black relative z-10 ${balance >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>{formatMinutes(balance)}</p>
                          <div className="absolute top-0 right-0 p-4 opacity-5"><ClockIcon size={120}/></div>
                        </div>

                        {/* Employee History Table */}
                        <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                          <div className="bg-zinc-50/70 px-6 py-4 border-b border-zinc-200/80 flex items-center justify-between">
                            <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest">Meu Histórico Recente</h3>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => window.print()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-zinc-200 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-900 text-zinc-700 text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
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
                                        <tr key={`abs-${t.id}-${index}`} className="bg-amber-50/50">
                                          <td className="px-6 py-3 font-mono text-zinc-500">{safeFormatDate(t.date)}</td>
                                          <td colSpan={3} className="px-6 py-3 text-center text-amber-900 font-black uppercase text-[9px] tracking-widest">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]} {t.note ? `• ${t.note}` : ''}</td>
                                          <td className="px-6 py-3 text-center font-mono text-zinc-400">Abonado</td>
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
              
              {/* BANNER PRINCIPAL DA FILA */}
              <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white p-8 rounded-[2.5rem] shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                <div className="relative z-10">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-xs font-black uppercase tracking-wider mb-2">
                    <Flame size={14}/> Fila de Atendimento em Loja
                  </div>
                  <h2 className="text-3xl font-black font-serif italic">Ordem de Atendimento</h2>
                  <p className="text-amber-100 text-xs mt-1 max-w-xl">
                    Organizada pela chegada no ponto. Ao iniciar atendimento, o próximo assume a vez imediatamente. Ao finalizar, o vendedor vai para o fim da fila.
                  </p>
                </div>

                <div className="flex items-center gap-3 relative z-10 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => setIsShareQueueModalOpen(true)}
                    className="px-4 py-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 border border-white/20 backdrop-blur-sm"
                  >
                    <Smartphone size={16}/> Celular da Equipe
                  </button>

                  <div className="bg-white/10 backdrop-blur-md px-5 py-3 rounded-2xl text-center border border-white/20">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-200">Na Loja</span>
                    <p className="text-2xl font-black font-mono mt-0.5">
                      {salesQueue.waitingQueue.length + salesQueue.currentlyAttending.length}
                    </p>
                  </div>
                </div>
              </div>

              {/* ALERTA DE AUDITORIA: ATENDIMENTOS CONSECUTIVOS */}
              {attendanceStats.consecutiveAlert && (
                <div className="bg-amber-50 border-2 border-amber-400 p-5 rounded-[2rem] shadow-sm flex items-start gap-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="p-3 bg-amber-500 text-slate-950 rounded-2xl shrink-0">
                    <AlertTriangle size={24}/>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-black text-amber-950 uppercase tracking-wide">
                      Alerta de Rodízio da Fila: {attendanceStats.consecutiveAlert.count} Atendimentos Consecutivos
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      O vendedor <strong className="font-bold underline">{attendanceStats.consecutiveAlert.employeeName}</strong> realizou {attendanceStats.consecutiveAlert.count} atendimentos seguidos. Verifique se o rodízio e a vez dos colegas estão sendo cumpridos.
                    </p>
                  </div>
                </div>
              )}

              {/* SEÇÃO 1: ATENDIMENTOS EM ANDAMENTO AGORA */}
              {salesQueue.currentlyAttending.length > 0 && (
                <div className="bg-slate-900 text-white p-6 md:p-8 rounded-[2.5rem] shadow-xl border border-slate-800 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-400">
                      <Flame size={18} className="animate-pulse"/> Atendendo Clientes Agora ({salesQueue.currentlyAttending.length})
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      Ao concluir, o colaborador irá para o final da fila
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {salesQueue.currentlyAttending.map(({ employee, record, attendance }) => {
                      const isDirect = attendance.type === 'DIRECT';
                      const elapsedMin = Math.max(0, Math.round((currentTime.getTime() - attendance.startedTimestamp) / 60000));

                      return (
                        <div 
                          key={employee.id} 
                          className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col justify-between gap-4 ${isDirect ? 'bg-gradient-to-br from-amber-950/40 to-zinc-900 border-amber-400/60' : 'bg-zinc-900 border-zinc-700'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider mb-2 shadow-sm ${isDirect ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-amber-300 border border-zinc-700'}`}>
                                {isDirect ? <Star size={12}/> : <Award size={12}/>}
                                {isDirect ? 'Cliente Fidelizado (Preferência)' : 'Vez da Fila'}
                              </div>
                              <h4 className="text-2xl font-black font-serif italic text-white">{employee.name}</h4>
                              <p className="text-xs text-zinc-400 mt-0.5">
                                Iniciou às <strong className="text-white font-mono">{attendance.startedAt}</strong> • ⏱️ há ~{elapsedMin} min
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                            <button
                              type="button"
                              onClick={() => handleOpenFinishAttendance(employee.id)}
                              className="flex-1 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                            >
                              <Check size={16}/> Finalizar Atendimento
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelAttendance(employee.id)}
                              className="py-3 px-3 rounded-xl bg-white/10 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 font-bold text-xs uppercase transition-all"
                              title="Cancelar atendimento acidental e retornar à posição na fila"
                            >
                              <RotateCcw size={15}/>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SEÇÃO 2: VENDEDOR DA VEZ (1º LUGAR DA FILA DE ESPERA) */}
              {salesQueue.waitingQueue.length > 0 ? (
                (() => {
                  const firstInLine = salesQueue.waitingQueue[0];
                  const stats = attendanceStats.counts[firstInLine.employee.id] || { total: 0, normal: 0, direct: 0, totalMinutes: 0 };

                  return (
                    <div className="bg-white border-2 border-amber-400 text-zinc-900 p-8 md:p-10 rounded-[3rem] shadow-xl text-center relative overflow-hidden transition-all">
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400 text-zinc-950 text-xs font-black uppercase tracking-widest mb-4 shadow-sm">
                        <Award size={14}/> 1º LUGAR • PRÓXIMO DA VEZ
                      </div>
                      <h3 className="text-4xl font-black font-serif italic mb-1">{firstInLine.employee.name}</h3>
                      <p className="text-xs font-bold uppercase tracking-wider mb-6 text-zinc-400">
                        {firstInLine.employee.role} • Chegou às {formatTime(firstInLine.record?.clockIn)} • {stats.total} atendimentos hoje ({stats.normal} vez / {stats.direct} fidelizado)
                      </p>

                      <div className="flex flex-wrap items-center justify-center gap-3 max-w-xl mx-auto">
                        <button
                          type="button"
                          onClick={() => handleStartAttendance(firstInLine.employee.id, 'NORMAL')}
                          className="flex-1 min-w-[200px] py-4 px-6 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 border border-amber-400/40 font-black text-sm uppercase tracking-wider shadow-lg shadow-amber-400/10 flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                          <Play size={18} className="fill-amber-400"/> Iniciar Atendimento da Vez
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => handleStartAttendance(firstInLine.employee.id, 'DIRECT')}
                          className="py-4 px-5 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 active:scale-95"
                          title="Quando o cliente procurou especificamente este vendedor"
                        >
                          <Star size={15} className="text-amber-600 fill-amber-500"/> Cliente Fidelizado
                        </button>

                        <button
                          type="button"
                          onClick={() => handlePassTurn(firstInLine.employee.id)}
                          className="py-4 px-4 rounded-2xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1"
                          title="Passar a vez caso o vendedor esteja ocupado no momento"
                        >
                          <SkipForward size={16}/> Passar Vez
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-zinc-200/80 text-center">
                  <ClockIcon size={48} className="mx-auto text-zinc-300 mb-3"/>
                  <h3 className="text-lg font-black text-zinc-800">
                    {salesQueue.currentlyAttending.length > 0 
                      ? 'Todos os vendedores presentes estão em atendimento no momento' 
                      : 'Nenhum vendedor disponível na fila no momento'}
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Conforme os vendedores baterem o ponto de entrada ou finalizarem atendimentos, eles reingressam aqui automaticamente.
                  </p>
                </div>
              )}

              {/* SEÇÃO 3: PRÓXIMOS NA FILA (2º LUGAR EM DIANTE) */}
              {salesQueue.waitingQueue.length > 1 && (
                <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-zinc-200/80 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase text-zinc-400 tracking-widest">
                      Próximos na Fila de Espera ({salesQueue.waitingQueue.length - 1})
                    </h4>
                    <span className="text-[10px] text-zinc-400 font-bold">
                      Clique em "Cliente Fidelizado" se o cliente procurou o vendedor diretamente
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {salesQueue.waitingQueue.slice(1).map((q, idx) => {
                      const stats = attendanceStats.counts[q.employee.id] || { total: 0, normal: 0, direct: 0 };

                      return (
                        <div key={q.employee.id} className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80 flex flex-col justify-between gap-3 hover:border-amber-400 transition-all">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="w-8 h-8 rounded-xl bg-zinc-900 text-amber-400 text-xs font-black flex items-center justify-center shadow-sm">
                                {idx + 2}º
                              </span>
                              <div>
                                <p className="font-bold text-sm text-zinc-900">{q.employee.name.split(' ')[0]}</p>
                                <p className="text-[10px] text-zinc-500 font-medium">
                                  {stats.total} atend. ({stats.direct} fidelizados)
                                </p>
                              </div>
                            </div>
                            
                            <button
                              type="button"
                              onClick={() => handlePassTurn(q.employee.id)}
                              className="p-1.5 text-zinc-400 hover:text-amber-600 rounded-lg hover:bg-white transition-all"
                              title="Passar para o fim da fila"
                            >
                              <SkipForward size={14}/>
                            </button>
                          </div>

                          <div className="pt-2 border-t border-zinc-200 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => handleStartAttendance(q.employee.id, 'DIRECT')}
                              className="w-full py-2 px-3 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 border border-amber-200"
                              title="Iniciar atendimento de cliente que procurou este vendedor diretamente"
                            >
                              <Star size={13} className="text-amber-600 fill-amber-500"/> Cliente Fidelizado
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SEÇÃO 4: VENDEDORES EM PAUSA (ALMOÇO OU LANCHE) */}
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
                        <span className="text-[10px] text-amber-700 uppercase font-black">
                          ({q.status === 'IN_LUNCH' ? 'Almoço' : 'Lanche'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SEÇÃO 5: BALANÇO DIÁRIO DE ATENDIMENTOS & CONFERÊNCIA COM CUPONS PDV */}
              <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-zinc-200/80 space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black font-serif italic text-zinc-900 flex items-center gap-2">
                      <Receipt size={20} className="text-amber-600"/> Balanço do Dia & Conferência de Cupons
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Horários exatos de início e término para cruzar e validar com os cupons fiscais do sistema PDV.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setIsReconcileModalOpen(true);
                        setReconcileTab('upload');
                      }}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-zinc-950 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md shadow-amber-400/20 active:scale-95"
                    >
                      <FileSpreadsheet size={15}/> Conciliar com Excel / Riser
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const text = attendanceStats.completedToday.map(a => {
                          const emp = data.employees.find(e => e.id === a.employeeId)?.name || 'Vendedor';
                          const valorStr = a.saleAmount ? ` | R$ ${a.saleAmount.toFixed(2).replace('.', ',')}` : '';
                          return `${a.startedAt} às ${a.endedAt || '--:--'} (${a.durationMinutes || 0}m) | ${emp} | ${a.type === 'DIRECT' ? 'FIDELIZADO' : 'VEZ'} | Cupom: ${a.saleNote || 'N/A'}${valorStr}`;
                        }).join('\n');
                        navigator.clipboard.writeText(`BALANÇO DE ATENDIMENTOS - ${getLocalDateString(currentTime)}\n\n` + text);
                        alert("Balanço copiado para a área de transferência!");
                      }}
                      className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5"
                    >
                      <Copy size={14}/> Copiar Balanço
                    </button>
                  </div>
                </div>

                {/* MÉTRICAS RÁPIDAS */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200/80">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Total Atendimentos</span>
                    <p className="text-2xl font-black font-mono text-zinc-900">{attendanceStats.totalAttendances}</p>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 text-white">
                    <span className="text-[10px] font-black uppercase text-amber-400">Pela Vez da Fila</span>
                    <p className="text-2xl font-black font-mono text-amber-400">{attendanceStats.totalNormal}</p>
                  </div>
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                    <span className="text-[10px] font-black uppercase text-amber-700">Clientes Fidelizados</span>
                    <p className="text-2xl font-black font-mono text-amber-950">{attendanceStats.totalDirect}</p>
                  </div>
                  <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                    <span className="text-[10px] font-black uppercase text-emerald-700">Duração Média</span>
                    <p className="text-2xl font-black font-mono text-emerald-900">{attendanceStats.avgDuration} min</p>
                  </div>
                </div>

                {/* TABELA DE ATENDIMENTOS DO DIA */}
                {attendanceStats.completedToday.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-200 text-[10px] font-black uppercase text-zinc-400 tracking-wider bg-zinc-50/70">
                          <th className="py-3 px-3">Vendedor</th>
                          <th className="py-3 px-3">Tipo</th>
                          <th className="py-3 px-3">Início</th>
                          <th className="py-3 px-3">Término</th>
                          <th className="py-3 px-3">Duração</th>
                          <th className="py-3 px-3">Cupom & Venda Riser</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                        {attendanceStats.completedToday.map(a => {
                          const emp = data.employees.find(e => e.id === a.employeeId);
                          const isDirect = a.type === 'DIRECT';

                          return (
                            <tr key={a.id} className="hover:bg-zinc-50/80 transition-colors">
                              <td className="py-3 px-3 font-bold text-zinc-900">
                                {emp?.name || 'Vendedor'}
                              </td>
                              <td className="py-3 px-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${isDirect ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-zinc-900 text-amber-400 border border-zinc-800'}`}>
                                  {isDirect ? '⭐ Fidelizado' : '👥 Vez da Fila'}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-mono font-bold text-zinc-900">{a.startedAt}</td>
                              <td className="py-3 px-3 font-mono font-bold text-zinc-900">{a.endedAt || '--:--'}</td>
                              <td className="py-3 px-3 font-mono text-zinc-600">{a.durationMinutes || 0} min</td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    placeholder="Inserir Nº do Cupom..."
                                    defaultValue={a.saleNote || ''}
                                    onBlur={(e) => handleUpdateAttendanceSaleNote(a.id, e.target.value)}
                                    className="w-full max-w-[180px] px-2.5 py-1 text-xs rounded-lg border border-zinc-200 focus:border-amber-400 focus:outline-none bg-zinc-50/50 hover:bg-white"
                                  />
                                  {a.saleAmount !== undefined && a.saleAmount > 0 && (
                                    <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-mono font-black text-xs shrink-0 border border-emerald-200">
                                      R$ {a.saleAmount.toFixed(2).replace('.', ',')}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center py-6 text-xs text-zinc-400 italic">
                    Nenhum atendimento finalizado registrado hoje ainda. Conforme os atendimentos forem concluídos, eles serão listados aqui cronologicamente.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB: CALENDÁRIO DE FERIADOS */}
          {activeTab === 'holidays' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-zinc-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black font-serif italic text-zinc-900">Calendário de Feriados</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">Feriados cadastrados aqui têm meta automática de 0h para quem folgar, sem gerar faltas ou débitos.</p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadOfficialHolidays}
                  className="px-4 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200 text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2"
                >
                  <RefreshCw size={14}/> Carregar Feriados de Petrópolis (2026)
                </button>
              </div>

              {/* Form Adicionar Feriado */}
              <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-zinc-200/80">
                <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest mb-4">Adicionar Novo Feriado</h3>
                <form onSubmit={handleAddHoliday} className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4 items-end">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Data *</span>
                    <input
                      type="date"
                      required
                      value={newHoliday.date}
                      onChange={e => setNewHoliday({ ...newHoliday, date: e.target.value })}
                      className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-black text-xs outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Nome do Feriado *</span>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Aniversário de Petrópolis"
                      value={newHoliday.name}
                      onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })}
                      className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </label>
                  <button
                    type="submit"
                    className="py-3 px-5 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 border border-amber-400/30"
                  >
                    <Plus size={16}/> Salvar Feriado
                  </button>
                </form>
              </div>

              {/* Lista de Feriados Cadastrados */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200/80 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest">Feriados Ativos ({data.holidays.length})</h3>
                  <CalendarDays size={16} className="text-zinc-300"/>
                </div>
                <div className="divide-y divide-zinc-100">
                  {data.holidays.map(h => (
                    <div key={h.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50/80 transition-all">
                      <div className="flex items-center gap-4">
                        <span className="font-mono font-black text-sm text-amber-950 bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-xl">{safeFormatDate(h.date)}</span>
                        <div>
                          <p className="font-bold text-sm text-zinc-800">{h.name}</p>
                          <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400">{h.type === 'MUNICIPAL' ? 'Feriado Municipal de Petrópolis' : 'Feriado Nacional'}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteHoliday(h.id)}
                        className="p-2 text-zinc-300 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all"
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
                          <p className="font-bold text-xs text-zinc-800">{item.employee.name} • {item.description}</p>
                        </div>
                        <button
                          onClick={() => {
                            const rec = data.records.find(r => r.id === item.recordId);
                            if (rec) openClockEditor(rec);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-zinc-950 text-amber-400 font-black text-[10px] uppercase tracking-wider hover:bg-zinc-800 transition-all flex items-center gap-1 shrink-0 border border-amber-400/30"
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
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-zinc-200/80">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Presentes na Loja</span>
                  <p className="text-3xl font-black font-mono text-zinc-900 mt-2">
                    {data.records.filter(r => r.date === getLocalDateString(currentTime) && r.clockIn && !r.clockOut).length}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-zinc-200/80">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Em Intervalo</span>
                  <p className="text-3xl font-black font-mono text-amber-600 mt-2">
                    {data.records.filter(r => r.date === getLocalDateString(currentTime) && ((r.lunchStart && !r.lunchEnd) || (r.snackStart && !r.snackEnd))).length}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-zinc-200/80">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Feriados Ativos</span>
                  <p className="text-3xl font-black font-mono text-emerald-600 mt-2">{data.holidays.length}</p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-zinc-200/80">
                  <span className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Colaboradores</span>
                  <p className="text-3xl font-black font-mono text-zinc-900 mt-2">{data.employees.filter(e => e.isActive !== false).length}</p>
                </div>
              </div>

              {/* QUADRO GERAL DOS COLABORADORES */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200/80 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest">Status Geral da Equipe Hoje</h3>
                  <Users size={16} className="text-zinc-300"/>
                </div>
                <div className="divide-y divide-zinc-100">
                  {data.employees.map(emp => {
                    const todayRec = data.records.find(r => r.employeeId === emp.id && r.date === getLocalDateString(currentTime));
                    const balance = getCumulativeBalance(emp.id);
                    return (
                      <div key={emp.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50/80 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-zinc-900 text-amber-400 font-black text-sm flex items-center justify-center shadow-sm">{emp.name.charAt(0)}</div>
                          <div>
                            <p className="font-bold text-sm text-zinc-900">{emp.name}</p>
                            <p className="text-[10px] text-zinc-400 font-bold uppercase">{emp.role || 'Sem Cargo'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="text-[9px] font-black uppercase text-zinc-400 block">Entrada Hoje</span>
                            <span className="font-mono font-bold text-xs text-zinc-800">{formatTime(todayRec?.clockIn)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-black uppercase text-zinc-400 block">Saldo Banco</span>
                            <span className={`font-mono font-black text-xs ${balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMinutes(balance)}</span>
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
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-zinc-200/80">
                <h3 className="text-xl font-black font-serif italic mb-4 text-zinc-900">{editingEmployeeId ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
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
                      <span className="text-[10px] font-black uppercase text-zinc-400">Nome Completo *</span>
                      <input required value={newEmp.name} onChange={e => setNewEmp({ ...newEmp, name: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400" placeholder="Nome do colaborador"/>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">Cargo / Função</span>
                      <input value={newEmp.role} onChange={e => setNewEmp({ ...newEmp, role: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400" placeholder="Ex: Vendedor, Gerente"/>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">Jornada Padrão</span>
                      <select value={newEmp.dailyHours} onChange={e => setNewEmp({ ...newEmp, dailyHours: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="8">8 horas / dia (CLT)</option>
                        <option value="6">6 horas / dia (Estágio - Patrícia)</option>
                        <option value="4">4 horas / dia</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">Dia Curto ou Folga Semanal</span>
                      <select 
                        value={`${newEmp.englishDay}_${newEmp.shortDayHours}`} 
                        onChange={e => {
                          const [d, h] = e.target.value.split('_');
                          setNewEmp({ ...newEmp, englishDay: d, shortDayHours: h });
                        }} 
                        className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400"
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
                      <span className="text-[10px] font-black uppercase text-zinc-400">Saldo Inicial</span>
                      <input value={newEmp.initialBalanceStr} onChange={e => setNewEmp({ ...newEmp, initialBalanceStr: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-mono font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400" placeholder="00:00"/>
                    </label>
                  </div>

                  {/* Opção Fila da Vez */}
                  <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-amber-950">Participa da Fila da Vez (Vendas em Loja)</p>
                      <p className="text-[10px] text-amber-750">Marque para vendedores de atendimento. Desmarque para cargos administrativos e estagiários.</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={newEmp.isSalesperson}
                      onChange={e => setNewEmp({ ...newEmp, isSalesperson: e.target.checked })}
                      className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    {editingEmployeeId && (
                      <button type="button" onClick={() => { setEditingEmployeeId(null); setNewEmp({ name: '', role: '', dailyHours: '8', englishDay: '6', shortDayHours: '4', initialBalanceStr: '00:00', isHourly: false, isSalesperson: true, startDate: DEFAULT_START_DATE }); }} className="py-3 px-5 rounded-xl bg-zinc-100 text-zinc-600 font-black text-xs uppercase">Cancelar</button>
                    )}
                    <button type="submit" disabled={isSaving} className="py-3 px-6 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 border border-amber-400/30">
                      {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <UserPlus size={14}/>} {editingEmployeeId ? 'Atualizar Colaborador' : 'Cadastrar Colaborador'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Lista de Colaboradores */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200/80 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest">Equipe Ativa ({data.employees.length})</h3>
                  <Users size={16} className="text-zinc-300"/>
                </div>
                <div className="divide-y divide-zinc-100">
                  {data.employees.map(emp => (
                    <div key={emp.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50/80 transition-all">
                      <div>
                        <p className="font-bold text-sm text-zinc-900 flex items-center gap-2">
                          {emp.name}
                          {emp.isSalesperson && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[8px] font-black uppercase tracking-wider border border-amber-200">Fila da Vez</span>}
                        </p>
                        <p className="text-[10px] text-zinc-400">
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
                          className="p-2 text-zinc-400 hover:text-amber-600 rounded-lg hover:bg-amber-50 transition-all"
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
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-zinc-200/80">
                <h3 className="text-xl font-black font-serif italic mb-4 text-zinc-900">Lançar Justificativa ou Evento Externo</h3>
                <form onSubmit={handleSaveJustification} className="space-y-4">
                  <div className={`grid grid-cols-1 ${justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">Colaborador *</span>
                      <select required value={justificationForm.employeeId} onChange={e => setJustificationForm({ ...justificationForm, employeeId: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="">Selecione...</option>
                        {data.employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">Tipo de Lançamento *</span>
                      <select value={justificationForm.type} onChange={e => {
                        const newType = e.target.value as EntryType;
                        setJustificationForm(prev => ({
                          ...prev,
                          type: newType,
                          endDate: prev.endDate < prev.date ? prev.date : prev.endDate
                        }));
                      }} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="VACATION">🌴 Férias (Período)</option>
                        <option value="MEDICAL">🩺 Atestado Médico</option>
                        <option value="OFF_DAY">🏖️ Folga Compensatória (de Domingo/Feriado)</option>
                        <option value="WORK_EXTERNAL">🎪 Trabalho em Evento Externo</option>
                        <option value="HOLIDAY">🚩 Feriado Trabalhado (Regra Petrópolis)</option>
                        <option value="BONUS">⭐ Bônus / Gratificação</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-zinc-400">{justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL' ? 'Data Início *' : 'Data *'}</span>
                      <input type="date" required value={justificationForm.date} onChange={e => {
                        const newStart = e.target.value;
                        setJustificationForm(prev => ({
                          ...prev,
                          date: newStart,
                          endDate: prev.endDate < newStart ? newStart : prev.endDate
                        }));
                      }} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-black text-xs outline-none focus:ring-2 focus:ring-amber-400"/>
                    </label>
                    {(justificationForm.type === 'VACATION' || justificationForm.type === 'MEDICAL') && (
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-zinc-400">Data Fim *</span>
                        <input type="date" required min={justificationForm.date} value={justificationForm.endDate} onChange={e => setJustificationForm({ ...justificationForm, endDate: e.target.value })} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-black text-xs outline-none focus:ring-2 focus:ring-amber-400"/>
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
                    <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-amber-900">Horário Início do Evento</span>
                        <input type="time" value={justificationForm.startTime} onChange={e => setJustificationForm({ ...justificationForm, startTime: e.target.value })} className="w-full p-3 rounded-xl bg-white border border-amber-200 font-mono font-bold text-xs"/>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-black uppercase text-amber-900">Horário Término do Evento</span>
                        <input type="time" value={justificationForm.endTime} onChange={e => setJustificationForm({ ...justificationForm, endTime: e.target.value })} className="w-full p-3 rounded-xl bg-white border border-amber-200 font-mono font-bold text-xs"/>
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
                    <span className="text-[10px] font-black uppercase text-zinc-400">Observação / Nome do Evento</span>
                    <input value={justificationForm.note} onChange={e => setJustificationForm({ ...justificationForm, note: e.target.value })} placeholder="Ex: Feira de Negócios / Atestado Dr. Silva" className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400"/>
                  </label>

                  <button type="submit" disabled={isSaving} className="py-3 px-6 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2 border border-amber-400/30">
                    {isSaving ? <RefreshCw className="animate-spin" size={14}/> : <CheckCircle2 size={14}/>} Confirmar Lançamento
                  </button>
                </form>
              </div>

              {/* Lista de Justificativas e Lançamentos */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                <div className="px-6 py-4 bg-zinc-50/70 border-b border-zinc-200/80 flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-zinc-400 tracking-widest">Histórico de Lançamentos</h3>
                  <ShieldCheck size={16} className="text-zinc-300"/>
                </div>
                <div className="divide-y divide-zinc-100">
                  {data.timeBank.filter(t => t.type !== 'WORK').map(t => {
                    const emp = data.employees.find(e => e.id === t.employeeId);
                    return (
                      <div key={t.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50/80 transition-all">
                        <div>
                          <p className="font-bold text-xs text-zinc-800">{emp?.name || '---'} • <span className="text-amber-700 font-black">{ENTRY_TYPE_LABELS[t.type as keyof typeof ENTRY_TYPE_LABELS]}</span></p>
                          <p className="text-[10px] text-zinc-400">{safeFormatDate(t.date)} {t.note ? `• ${t.note}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold text-xs ${t.minutes >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatMinutes(t.minutes)}</span>
                          <button onClick={() => handleDeleteEntry(t.id, "Deseja excluir este lançamento?")} className="p-1.5 text-zinc-300 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all">
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
              <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-zinc-200/80 flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full md:w-auto">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Data Inicial</span>
                    <input type="date" value={reportFilter.startDate} onChange={e => setReportFilter({ ...reportFilter, startDate: e.target.value })} className="w-full p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs"/>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Data Final</span>
                    <input type="date" value={reportFilter.endDate} onChange={e => setReportFilter({ ...reportFilter, endDate: e.target.value })} className="w-full p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs"/>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-zinc-400">Colaborador</span>
                    <select value={reportFilter.employeeId} onChange={e => setReportFilter({ ...reportFilter, employeeId: e.target.value })} className="w-full p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs">
                      <option value="all">Todos os colaboradores</option>
                      {data.employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={openCreateClockModal} className="px-4 py-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 border border-amber-400/30 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                    <Plus size={14}/> Incluir Ponto
                  </button>
                  <button onClick={handleExportAccountantReport} className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-md">
                    <Download size={14}/> Exportar CSV
                  </button>
                </div>
              </div>

              {/* Tabela de Registros */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-zinc-200/80 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-bold">
                    <thead className="bg-zinc-50/70 text-[9px] font-black uppercase text-zinc-400">
                      <tr>
                        <th className="px-6 py-4">Data</th>
                        <th className="px-6 py-4">Colaborador</th>
                        <th className="px-6 py-4 text-center">Horário E/S</th>
                        <th className="px-6 py-4 text-center">Saldo Diário</th>
                        <th className="px-6 py-4 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredRecords.map(r => {
                        const emp = data.employees.find(e => e.id === r.employeeId);
                        const tbe = data.timeBank.find(t => t.employeeId === r.employeeId && t.date === r.date && t.type === 'WORK');
                        return (
                          <tr key={r.id} className="hover:bg-zinc-50/80 transition-all">
                            <td className="px-6 py-4 font-mono text-zinc-500">{safeFormatDate(r.date)}</td>
                            <td className="px-6 py-4 font-bold text-zinc-900">{emp?.name || '---'}</td>
                            <td className="px-6 py-4 text-center font-mono text-zinc-700">{formatTime(r.clockIn)} - {formatTime(r.clockOut)}</td>
                            <td className={`px-6 py-4 text-center font-mono font-black ${tbe && tbe.minutes >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{tbe ? formatMinutes(tbe.minutes) : '---'}</td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button title="Corrigir horários" onClick={() => openClockEditor(r)} className="p-2 text-zinc-400 hover:text-amber-600"><Edit2 size={16}/></button>
                                <button title="Excluir ponto" onClick={() => handleDeleteFullRecord(r.id, r.employeeId, r.date)} className="p-2 text-zinc-300 hover:text-rose-600"><Trash2 size={16}/></button>
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
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-zinc-200/80 max-w-xl">
                <h3 className="text-xl font-black font-serif italic mb-2 text-zinc-900">Ajuste de PIN de Gerência</h3>
                <p className="text-xs text-zinc-400 mb-6">Altere a senha numérica de 4 dígitos para acesso aos módulos gerenciais.</p>
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
                    <span className="text-[10px] font-black uppercase text-zinc-400">Novo PIN (4 dígitos)</span>
                    <input name="pin" type="password" maxLength={4} defaultValue={data.settings?.managerPin || "1234"} className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-mono font-bold text-center text-lg outline-none focus:ring-2 focus:ring-amber-400"/>
                  </label>
                  <button type="submit" className="py-3 px-6 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black text-xs uppercase tracking-wider shadow-md transition-all border border-amber-400/30">Salvar Novo PIN</button>
                </form>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* MODAL AUTODECLARAÇÃO: ESQUECI DE BATER ENTRADA */}
      {isSelfDeclareModalOpen && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-in fade-in">
          <form onSubmit={handleSaveSelfDeclaration} className="bg-white text-zinc-800 w-full max-w-lg p-7 md:p-9 rounded-[2.5rem] shadow-2xl relative border border-zinc-100">
            <button
              type="button"
              onClick={() => { setIsSelfDeclareModalOpen(false); setSelfDeclareEmployeeId(null); }}
              disabled={isSaving}
              className="absolute top-6 right-6 text-zinc-300 hover:text-zinc-900 disabled:opacity-40"
            >
              <X size={24}/>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                <ClockIcon size={24}/>
              </div>
              <div>
                <h2 className="text-2xl font-black font-serif italic text-zinc-900">Informar Chegada</h2>
                <p className="text-xs font-bold text-zinc-400">
                  {data.employees.find(e => e.id === selfDeclareEmployeeId)?.name} • {safeFormatDate(getLocalDateString(currentTime))}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 mb-4 leading-relaxed">
              Informe o horário exato em que você chegou na loja hoje. Este registro será gravado com o timestamp de confirmação para segurança mútua.
            </p>

            {/* Atalhos Rápidos */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setSelfDeclareTime('10:00')}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-all ${selfDeclareTime === '10:00' ? 'bg-zinc-950 text-amber-400 border border-amber-400/30' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                10:00 (Abertura)
              </button>
              <button
                type="button"
                onClick={() => setSelfDeclareTime('14:30')}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-all ${selfDeclareTime === '14:30' ? 'bg-zinc-950 text-amber-400 border border-amber-400/30' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                14:30 (Turno Tarde)
              </button>
            </div>

            <div className="space-y-4">
              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase text-zinc-400">Horário Exato de Entrada *</span>
                <input
                  type="time"
                  required
                  value={selfDeclareTime}
                  onChange={e => setSelfDeclareTime(e.target.value)}
                  className="w-full p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 font-mono font-black text-lg text-center outline-none focus:ring-2 focus:ring-amber-400"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-[10px] font-black uppercase text-zinc-400">Motivo (Opcional)</span>
                <input
                  type="text"
                  placeholder="Ex: Esqueci de registrar ao abrir a loja"
                  value={selfDeclareNote}
                  onChange={e => setSelfDeclareNote(e.target.value)}
                  className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-bold text-xs outline-none focus:ring-2 focus:ring-amber-400"
                />
              </label>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setIsSelfDeclareModalOpen(false); setSelfDeclareEmployeeId(null); }}
                disabled={isSaving}
                className="flex-1 py-3.5 rounded-xl bg-zinc-100 text-zinc-500 font-black uppercase text-xs disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black uppercase text-xs flex items-center justify-center gap-2 shadow-lg border border-amber-400/30 disabled:opacity-60 transition-all"
              >
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} Confirmar Entrada
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL EDIÇÃO MANUAL DE PONTO (GERENTE) */}
      {(editingClockRecord || creatingClockRecord) && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-in fade-in">
          <form onSubmit={handleSaveClockEdit} className="bg-white text-zinc-800 w-full max-w-2xl p-7 md:p-9 rounded-[2rem] shadow-2xl relative border border-zinc-100">
            <button type="button" onClick={closeClockEditor} disabled={isSaving} className="absolute top-6 right-6 text-zinc-300 hover:text-zinc-900 disabled:opacity-40"><X size={24}/></button>
            <div className="pr-10 mb-6">
              <h2 className="text-2xl font-black font-serif italic">{editingClockRecord ? 'Corrigir batidas' : 'Incluir ponto'}</h2>
              <p className="text-xs font-bold text-zinc-400 mt-1">
                {editingClockRecord
                  ? `${data.employees.find(emp => emp.id === editingClockRecord.employeeId)?.name} • ${safeFormatDate(editingClockRecord.date)}`
                  : 'Cadastre os horários informados pelo funcionário.'}
              </p>
            </div>

            {creatingClockRecord && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 p-4 rounded-2xl bg-amber-50/80 border border-amber-200">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-amber-900">Colaborador *</span>
                  <select
                    required
                    value={creatingClockRecord.employeeId}
                    onChange={event => setCreatingClockRecord(current => current ? ({ ...current, employeeId: event.target.value }) : current)}
                    className="w-full p-3 rounded-xl bg-white border border-amber-200 font-bold outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">Selecione...</option>
                    {data.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-amber-900">Data *</span>
                  <input
                    type="date"
                    required
                    max={getLocalDateString(new Date())}
                    value={creatingClockRecord.date}
                    onChange={event => setCreatingClockRecord(current => current ? ({ ...current, date: event.target.value }) : current)}
                    className="w-full p-3 rounded-xl bg-white border border-amber-200 font-black outline-none focus:ring-2 focus:ring-amber-400"
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
                  <span className="text-[10px] font-black uppercase text-zinc-400">{label}{required ? ' *' : ''}</span>
                  <input
                    type="time"
                    required={required}
                    value={clockEditForm[field]}
                    onChange={event => setClockEditForm(current => ({ ...current, [field]: event.target.value }))}
                    className="w-full p-3 rounded-xl bg-zinc-50 border border-zinc-200 font-mono font-black outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </label>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={closeClockEditor} disabled={isSaving} className="flex-1 py-3 rounded-xl bg-zinc-100 text-zinc-500 font-black uppercase text-xs disabled:opacity-40">Cancelar</button>
              <button type="submit" disabled={isSaving} className="flex-1 py-3 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black uppercase text-xs flex items-center justify-center gap-2 border border-amber-400/30 disabled:opacity-60">
                {isSaving ? <RefreshCw className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>} {editingClockRecord ? 'Salvar correção' : 'Incluir ponto'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL PIN */}
      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-in fade-in">
           <div className="bg-white w-full max-w-[340px] p-8 md:p-10 rounded-[3rem] shadow-2xl relative text-center border border-zinc-100">
              <button onClick={() => setIsLoginModalOpen(false)} className="absolute top-8 right-8 text-zinc-300 hover:text-zinc-900"><X size={24}/></button>
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner"><Lock size={32}/></div>
              <h2 className="text-2xl font-black font-serif italic mb-1 text-zinc-900">Acesso Gerente</h2>
              <div className="flex justify-center gap-4 my-8">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-3 h-3 rounded-full ${pinInput.length > i ? 'bg-amber-500 scale-125' : 'bg-zinc-200'} ${loginError ? 'bg-rose-500' : ''}`}></div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','<'].map(v => (
                  <button key={v} onClick={() => v === 'C' ? setPinInput('') : v === '<' ? setPinInput(p => p.slice(0,-1)) : handlePinDigit(v)} className="h-14 rounded-xl font-black text-xl bg-zinc-50 hover:bg-zinc-950 hover:text-amber-400 transition-all">{v}</button>
                ))}
              </div>
           </div>
        </div>
      )}

      {/* MODAL REGRAS CLT & DIREITOS DE PONTO */}
      {isCltModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white text-zinc-800 w-full max-w-3xl p-6 md:p-10 rounded-[2.5rem] shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto border border-zinc-100">
            <button
              type="button"
              onClick={() => setIsCltModalOpen(false)}
              className="absolute top-6 right-6 text-zinc-400 hover:text-zinc-900 p-2 rounded-full hover:bg-zinc-100 transition-all"
            >
              <X size={24}/>
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                <BookOpen size={24}/>
              </div>
              <div>
                <h2 className="text-2xl font-black font-serif italic text-slate-900">Regras da CLT & Direitos de Ponto</h2>
                <p className="text-xs font-bold text-slate-400">Guia de transparência e direitos para os colaboradores</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80">
                <h3 className="font-black text-zinc-900 flex items-center gap-2 mb-1">
                  <span className="text-amber-600 font-mono">01.</span> Tolerância de Ponto (Art. 58, § 1º da CLT & Súmula 366 TST)
                </h3>
                <p className="text-zinc-600 leading-relaxed font-normal">
                  Variações de <strong>até 5 minutos</strong> por batida (e até <strong>10 minutos no total do dia</strong>) não são descontadas e nem computadas como hora extra. 
                  Se a variação ultrapassar 5 minutos ou o total do dia passar de 10 minutos, o tempo total é computado como hora extra ou hora devida.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80">
                <h3 className="font-black text-zinc-900 flex items-center gap-2 mb-1">
                  <span className="text-amber-600 font-mono">02.</span> Intervalo de Almoço (Art. 71 da CLT)
                </h3>
                <p className="text-zinc-600 leading-relaxed font-normal">
                  Para jornadas de 8 horas diárias, o intervalo para refeição e descanso é de <strong>no mínimo 1 hora</strong>. O intervalo de almoço não é computado na jornada de trabalho.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
                <h3 className="font-black text-amber-950 flex items-center gap-2 mb-1">
                  <span className="text-amber-600 font-mono">03.</span> Pausa para Lanche (Benefício Concedido pela Empresa)
                </h3>
                <p className="text-amber-900/90 leading-relaxed font-normal">
                  A empresa concede uma pausa de <strong>até 15 minutos</strong> para café/lanche como benefício aos colaboradores. 
                  Essa pausa de até 15 min <strong>não é descontada</strong> da sua jornada de 8h. Apenas minutos que excederem os 15 minutos serão deduzidos no banco de horas.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80">
                <h3 className="font-black text-zinc-900 flex items-center gap-2 mb-1">
                  <span className="text-amber-600 font-mono">04.</span> Descanso Entre Dias de Trabalho (Art. 66 da CLT)
                </h3>
                <p className="text-zinc-600 leading-relaxed font-normal">
                  Entre o encerramento do expediente de um dia e o início da jornada do dia seguinte, deve haver um período mínimo de <strong>11 horas consecutivas</strong> de descanso.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200/80">
                <h3 className="font-black text-zinc-900 flex items-center gap-2 mb-1">
                  <span className="text-amber-600 font-mono">05.</span> Feriados Trabalhados (Acordo de Petrópolis)
                </h3>
                <p className="text-zinc-600 leading-relaxed font-normal">
                  Feriados trabalhados garantem compensação com <strong>folga integral (+8h)</strong> e pagamento conforme a convenção coletiva local.
                </p>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-200/80 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-black uppercase tracking-wider transition-all"
              >
                <Download size={14}/>
                <span>Imprimir Este Guia</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCltModalOpen(false)}
                className="px-6 py-3 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 text-xs font-black uppercase tracking-wider transition-all shadow-lg border border-amber-400/30"
              >
                Entendi e Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE FINALIZAR ATENDIMENTO (COM CUPOM / OBS DA VENDA) */}
      {finishingAttendance && (() => {
        const emp = data.employees.find(e => e.id === finishingAttendance.employeeId);
        const now = new Date();
        const currentEndedAt = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const diffMin = Math.max(1, Math.round((Date.now() - finishingAttendance.startedTimestamp) / 60000));
        const isDirect = finishingAttendance.type === 'DIRECT';

        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-in fade-in">
            <div className="bg-white text-zinc-800 w-full max-w-md p-8 rounded-[2.5rem] shadow-2xl relative border border-zinc-100">
              <button 
                type="button"
                onClick={() => setFinishingAttendance(null)} 
                className="absolute top-6 right-6 text-zinc-400 hover:text-zinc-900 p-2 rounded-full hover:bg-zinc-100 transition-all"
              >
                <X size={20}/>
              </button>

              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                <CheckSquare size={28}/>
              </div>

              <h3 className="text-2xl font-black font-serif italic text-zinc-900 mb-1">
                Finalizar Atendimento
              </h3>
              <p className="text-xs text-zinc-400 mb-6">
                Ao confirmar, o colaborador <strong className="text-zinc-900 font-bold">{emp?.name}</strong> será posicionado no final da fila de espera.
              </p>

              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-100 space-y-2 mb-6">
                <div className="flex justify-between text-xs font-bold text-zinc-700">
                  <span>Tipo:</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${isDirect ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-zinc-900 text-amber-400'}`}>
                    {isDirect ? '⭐ Cliente Fidelizado' : '👥 Vez da Fila'}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>Horário Início:</span>
                  <span className="font-mono font-bold text-zinc-900">{finishingAttendance.startedAt}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>Horário Término:</span>
                  <span className="font-mono font-bold text-zinc-900">{currentEndedAt}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-zinc-800 pt-2 border-t border-zinc-200/80">
                  <span>Duração Estimada:</span>
                  <span className="font-mono text-emerald-700 font-black">~{diffMin} minutos</span>
                </div>
              </div>

              <form onSubmit={(e) => {
                e.preventDefault();
                handleCompleteAttendance(finishingAttendance.employeeId, finishSaleNote);
              }} className="space-y-4">
                <label className="space-y-1 block">
                  <span className="text-[10px] font-black uppercase text-slate-400">
                    Nº do Cupom Fiscal / Venda PDV (Opcional)
                  </span>
                  <input
                    type="text"
                    autoFocus
                    value={finishSaleNote}
                    onChange={(e) => setFinishSaleNote(e.target.value)}
                    placeholder="Ex: Cupom #1042 / Venda R$ 350,00"
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[9px] text-slate-400 block mt-0.5">
                    Permite cruzar depois com o relatório do sistema de caixa.
                  </span>
                </label>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setFinishingAttendance(null)}
                    className="flex-1 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-black uppercase text-xs transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase text-xs shadow-lg flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  >
                    <Check size={18}/> Concluir
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL DE COMPARTILHAR LINK DA FILA PARA O CELULAR DA EQUIPE */}
      {isShareQueueModalOpen && (() => {
        const queueUrl = typeof window !== 'undefined' 
          ? `${window.location.origin}${window.location.pathname}?view=queue` 
          : '?view=queue';

        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in">
            <div className="bg-white text-slate-800 w-full max-w-lg p-8 md:p-10 rounded-[2.5rem] shadow-2xl relative border border-slate-100">
              <button 
                type="button"
                onClick={() => {
                  setIsShareQueueModalOpen(false);
                  setCopiedLinkFeedback(false);
                }} 
                className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 p-2 rounded-full hover:bg-slate-100 transition-all"
              >
                <X size={20}/>
              </button>

              <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                <Smartphone size={28}/>
              </div>

              <h3 className="text-2xl font-black font-serif italic text-slate-900 mb-1">
                Fila da Vez no Celular da Equipe
              </h3>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                Envie este link para o WhatsApp ou celular dos vendedores. Ele abre <strong>apenas a Fila de Atendimento</strong> (sem acesso a bater ponto, sem acesso à gerência e sem ocupar espaço no aparelho).
              </p>

              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-700 truncate select-all">{queueUrl}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(queueUrl);
                      setCopiedLinkFeedback(true);
                      setTimeout(() => setCopiedLinkFeedback(false), 2500);
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider shrink-0 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    {copiedLinkFeedback ? <Check size={14}/> : <Copy size={14}/>}
                    {copiedLinkFeedback ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-100 space-y-2 text-xs text-amber-950">
                  <p className="font-black flex items-center gap-1.5 text-amber-900">
                    <Star size={14} className="text-amber-600 fill-amber-500"/> Dica para o Vendedor:
                  </p>
                  <p className="leading-relaxed">
                    O vendedor pode abrir este link no Chrome ou Safari e clicar em <strong>"Adicionar à tela de início"</strong>. Um ícone será criado no celular dele como um aplicativo leve, sem ocupar memória.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsShareQueueModalOpen(false)}
                  className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-black uppercase text-xs hover:bg-slate-800 transition-all mt-2"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL DE CONCILIAÇÃO AUTOMÁTICA DE CUPONS RISER */}
      {isReconcileModalOpen && (() => {
        const matchedCount = reconciledItems.filter(r => r.status === 'MATCHED' && r.matchedCoupon).length;
        const totalSalesAmount = reconciledItems.reduce((acc, r) => acc + (r.matchedCoupon?.valor || 0), 0);
        const totalCompleted = todayAttendances.filter(a => a.status === 'COMPLETED').length;
        const conversionRate = totalCompleted > 0 ? (matchedCount / totalCompleted) * 100 : 0;
        const avgTicket = matchedCount > 0 ? totalSalesAmount / matchedCount : 0;

        return (
          <div className="fixed inset-0 z-[125] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in">
            <div className="bg-white text-zinc-900 w-full max-w-4xl p-6 md:p-9 rounded-[2.5rem] shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto border border-zinc-100 flex flex-col">
              
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-amber-400 text-zinc-950 flex items-center justify-center font-black shadow-md shadow-amber-400/20 shrink-0">
                    <FileSpreadsheet size={28}/>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black font-serif italic text-zinc-900">
                      Conciliação Automática com Cupons do Riser
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Cruza os horários de término de atendimento dos vendedores com os cupons de venda emitidos no caixa.
                    </p>
                  </div>
                </div>

                <button 
                  type="button"
                  onClick={() => setIsReconcileModalOpen(false)} 
                  className="p-2 rounded-full text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-all"
                >
                  <X size={22}/>
                </button>
              </div>

              {/* Tabs de Navegação */}
              <div className="flex items-center gap-2 border-b border-zinc-200 pb-3 mb-6 flex-wrap">
                <button
                  type="button"
                  onClick={() => setReconcileTab('upload')}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${reconcileTab === 'upload' ? 'bg-zinc-950 text-amber-400 shadow-sm' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  <Upload size={14}/> Subir Excel / CSV
                </button>
                <button
                  type="button"
                  onClick={() => setReconcileTab('paste')}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${reconcileTab === 'paste' ? 'bg-zinc-950 text-amber-400 shadow-sm' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  <Copy size={14}/> Colar Relatório (Ctrl+V)
                </button>
                {reconciledItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReconcileTab('results')}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${reconcileTab === 'results' ? 'bg-amber-400 text-zinc-950 font-black shadow-md shadow-amber-400/20' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}`}
                  >
                    <CheckCheck size={14}/> Ver Resultados ({matchedCount} Vendas)
                  </button>
                )}
              </div>

              {/* TAB 1: UPLOAD DE EXCEL */}
              {reconcileTab === 'upload' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="border-2 border-dashed border-zinc-300 hover:border-amber-400 rounded-3xl p-8 md:p-12 text-center bg-zinc-50/50 hover:bg-amber-50/20 transition-all flex flex-col items-center justify-center gap-4 group">
                    <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileSpreadsheet size={32}/>
                    </div>
                    <div>
                      <h4 className="text-base font-black text-zinc-900 mb-1">
                        Selecione o relatório exportado do Riser
                      </h4>
                      <p className="text-xs text-zinc-500 max-w-md mx-auto">
                        Suporta arquivos <strong>.xlsx</strong>, <strong>.xls</strong> e <strong>.csv</strong> exportados da tela "Relatórios dos Caixas / Cupons emitidos".
                      </p>
                    </div>
                    <label className="cursor-pointer px-6 py-3.5 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black text-xs uppercase tracking-wider shadow-lg shadow-zinc-900/10 flex items-center gap-2 border border-amber-400/30 active:scale-95 transition-all">
                      <Upload size={16}/>
                      <span>{isProcessingFile ? 'Processando Planilha...' : 'Escolher Arquivo do Computador'}</span>
                      <input
                        type="file"
                        accept=".xlsx, .xls, .csv"
                        className="hidden"
                        onChange={handleExcelUpload}
                        disabled={isProcessingFile}
                      />
                    </label>
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs text-amber-950 space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-amber-900">
                      💡 Como funciona o cruzamento automático:
                    </p>
                    <p className="leading-relaxed">
                      O sistema lê a data/hora e o valor de cada cupom e localiza qual vendedor encerrou o atendimento naquele mesmo intervalo de tempo. Vendas avulsas de balcão e cancelamentos são identificados automaticamente.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: COLAR DADOS DIRETO */}
              {reconcileTab === 'paste' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <label className="block text-xs font-black uppercase text-zinc-500 mb-1">
                      Cole aqui a tabela copiada da tela do Riser ou do Excel:
                    </label>
                    <textarea
                      rows={8}
                      value={rawPastedText}
                      onChange={(e) => setRawPastedText(e.target.value)}
                      placeholder={`ID\tLoja\tPDV\tData/Hora\tCupom\tTipo\tOperador\tStatus\tValor\n00163903\t0001\t004\t15/08/2026 10:15:07\t146268\tVenda\tandrea\tCupom encerrado\t69,90\n00163904\t0001\t004\t15/08/2026 10:27:57\t146269\tVenda\tandrea\tCupom encerrado\t136,80`}
                      className="w-full p-4 rounded-2xl bg-zinc-50 border border-zinc-200 font-mono text-xs outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white resize-y"
                    />
                    <span className="text-[10px] text-zinc-400 mt-1 block">
                      Dica: você pode selecionar as linhas na tela do Riser ou no Excel, dar Ctrl+C e colar direto aqui.
                    </span>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setRawPastedText('')}
                      className="px-5 py-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-black uppercase text-xs transition-all"
                    >
                      Limpar
                    </button>
                    <button
                      type="button"
                      onClick={handleProcessPastedText}
                      disabled={isProcessingFile || !rawPastedText.trim()}
                      className="px-6 py-3 rounded-xl bg-zinc-950 hover:bg-zinc-900 text-amber-400 font-black uppercase text-xs flex items-center gap-2 shadow-lg border border-amber-400/30 disabled:opacity-50 transition-all active:scale-95"
                    >
                      {isProcessingFile ? <RefreshCw className="animate-spin" size={16}/> : <Zap size={16}/>}
                      Processar e Cruzar Atendimentos
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: RESULTADOS DA CONCILIAÇÃO */}
              {reconcileTab === 'results' && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  
                  {/* Barra de Ajuste de Tolerância */}
                  <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal size={16} className="text-amber-600"/>
                      <div>
                        <span className="text-xs font-black uppercase text-zinc-800 block">
                          Tolerância de Tempo até o Caixa:
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          Tempo máximo que o cliente leva entre o fim do atendimento e a passagem no caixa.
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {[5, 10, 15, 20, 30].map(mins => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => {
                            setReconcileToleranceMin(mins);
                            executeReconciliation(importedCoupons, mins);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${reconcileToleranceMin === mins ? 'bg-zinc-950 text-amber-400 border border-amber-400/40 shadow-sm' : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'}`}
                        >
                          {mins} min
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* CARDS DE MÉTRICAS */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200">
                      <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">Faturamento Conciliado</span>
                      <p className="text-2xl font-black font-mono text-emerald-950 mt-1">
                        R$ {totalSalesAmount.toFixed(2).replace('.', ',')}
                      </p>
                    </div>

                    <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 text-white">
                      <span className="text-[10px] font-black uppercase text-amber-400 tracking-wider">Vendas Fechadas</span>
                      <p className="text-2xl font-black font-mono text-amber-400 mt-1">
                        {matchedCount} <span className="text-xs text-zinc-400 font-bold">/ {totalCompleted} atend.</span>
                      </p>
                    </div>

                    <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                      <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">Taxa de Conversão</span>
                      <p className="text-2xl font-black font-mono text-amber-950 mt-1">
                        {conversionRate.toFixed(1)}%
                      </p>
                    </div>

                    <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
                      <span className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Ticket Médio</span>
                      <p className="text-2xl font-black font-mono text-zinc-900 mt-1">
                        R$ {avgTicket.toFixed(2).replace('.', ',')}
                      </p>
                    </div>
                  </div>

                  {/* TABELA DE ATENDIMENTOS CONCILIADOS */}
                  <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                    <div className="px-5 py-3 bg-zinc-50/70 border-b border-zinc-200 flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase text-zinc-600 tracking-wider">
                        Cruzamento de Atendimentos vs Cupons ({reconciledItems.length})
                      </h4>
                      <span className="text-[10px] font-bold text-zinc-400">
                        {matchedCount} conciliados • {reconciledItems.length - matchedCount} sem venda
                      </span>
                    </div>

                    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-zinc-50 text-[10px] font-black uppercase text-zinc-400 sticky top-0 border-b border-zinc-200">
                          <tr>
                            <th className="py-2.5 px-3">Vendedor</th>
                            <th className="py-2.5 px-3">Horário Atend.</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Cupom Riser</th>
                            <th className="py-2.5 px-3">Horário Caixa</th>
                            <th className="py-2.5 px-3 text-right">Valor Venda</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 font-medium text-zinc-700">
                          {reconciledItems.map((item, idx) => {
                            const isMatched = item.status === 'MATCHED' && item.matchedCoupon;
                            return (
                              <tr key={idx} className={`hover:bg-zinc-50/80 transition-colors ${isMatched ? 'bg-emerald-50/30' : ''}`}>
                                <td className="py-2.5 px-3 font-bold text-zinc-900">
                                  {item.employeeName}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-zinc-600 text-[11px]">
                                  {item.attendance.startedAt} às {item.attendance.endedAt || '--:--'}
                                </td>
                                <td className="py-2.5 px-3">
                                  {isMatched ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-900 border border-emerald-200">
                                      <Check size={11}/> Venda Fechada
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-zinc-100 text-zinc-600">
                                      Sem Cupom
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-zinc-900">
                                  {isMatched ? (
                                    <span>
                                      #{item.matchedCoupon?.cupom} {item.matchedCoupon?.pdv ? `(PDV ${item.matchedCoupon.pdv})` : ''}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 italic">---</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-zinc-600 text-[11px]">
                                  {isMatched ? (
                                    <span>
                                      {item.matchedCoupon?.timeStr} {item.timeDiffMinutes !== undefined ? `(+${Math.max(0, item.timeDiffMinutes)}m)` : ''}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 italic">---</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-black text-zinc-900">
                                  {isMatched ? (
                                    <span className="text-emerald-700">
                                      R$ {item.matchedCoupon?.valor.toFixed(2).replace('.', ',')}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400 italic">R$ 0,00</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* CUPONS AVULSOS DO CAIXA (NÃO VINCULADOS) */}
                  {unmatchedCoupons.length > 0 && (
                    <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-black uppercase text-zinc-600 tracking-wider flex items-center gap-1.5">
                          <AlertCircle size={14} className="text-amber-600"/>
                          Cupons Emitidos no Caixa sem Atendimento na Fila ({unmatchedCoupons.length})
                        </h5>
                        <span className="text-[10px] text-zinc-400">Compras de balcão / diretas</span>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto">
                        {unmatchedCoupons.map((cp, idx) => (
                          <span key={idx} className="px-2.5 py-1 rounded-xl bg-white border border-zinc-200 text-[10px] font-mono font-bold text-zinc-700 shadow-sm">
                            Cupom #{cp.cupom} ({cp.timeStr}) • R$ {cp.valor.toFixed(2).replace('.', ',')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AÇÕES DE CONCLUSÃO */}
                  <div className="flex items-center justify-between gap-3 pt-4 border-t border-zinc-200 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setReconcileTab('upload')}
                      className="px-5 py-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-black uppercase text-xs transition-all"
                    >
                      Subir Outro Arquivo
                    </button>

                    <button
                      type="button"
                      onClick={handleApplyReconciliation}
                      disabled={reconcileAppliedFeedback}
                      className="px-7 py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-zinc-950 font-black uppercase text-xs tracking-wider shadow-xl shadow-amber-400/20 flex items-center gap-2 transition-all active:scale-95"
                    >
                      {reconcileAppliedFeedback ? (
                        <>
                          <Check size={18}/> Conciliação Aplicada com Sucesso!
                        </>
                      ) : (
                        <>
                          <CheckCheck size={18}/> Salvar e Aplicar no Balanço de Hoje
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

    </div>
  );
};

export default App;

