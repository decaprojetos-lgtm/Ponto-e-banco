import React from 'react';
import { 
  Users, 
  Clock, 
  FileText, 
  Settings, 
  TrendingUp, 
  Calendar,
  BookOpen,
  LogOut,
  UserPlus,
  Download,
  Flame,
  ShieldCheck,
  SlidersHorizontal,
  CalendarDays
} from 'lucide-react';

export const NAVIGATION_ITEMS = [
  { id: 'clock', label: 'Bater Ponto', icon: <Clock size={18} /> },
  { id: 'queue', label: 'Fila da Vez', icon: <Flame size={18} /> },
  { id: 'dashboard', label: 'Painel', icon: <TrendingUp size={18} /> },
  { id: 'employees', label: 'Equipe', icon: <Users size={18} /> },
  { id: 'holidays', label: 'Feriados', icon: <CalendarDays size={18} /> },
  { id: 'justifications', label: 'Justificativas', icon: <ShieldCheck size={18} /> },
  { id: 'admin', label: 'Ajustes', icon: <SlidersHorizontal size={18} /> },
  { id: 'reports', label: 'Relatórios', icon: <FileText size={18} /> },
];

export const WEEK_DAYS_BR = [
  'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'
];

export const STANDARD_PETROPOLIS_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: 'Confraternização Universal', type: 'NATIONAL' as const },
  { date: '2026-02-17', name: 'Carnaval', type: 'CUSTOM' as const },
  { date: '2026-03-16', name: 'Aniversário de Petrópolis', type: 'MUNICIPAL' as const },
  { date: '2026-04-03', name: 'Sexta-Feira Santa', type: 'NATIONAL' as const },
  { date: '2026-04-21', name: 'Tiradentes', type: 'NATIONAL' as const },
  { date: '2026-04-23', name: 'São Jorge (Estadual RJ)', type: 'MUNICIPAL' as const },
  { date: '2026-05-01', name: 'Dia do Trabalho', type: 'NATIONAL' as const },
  { date: '2026-06-04', name: 'Corpus Christi', type: 'NATIONAL' as const },
  { date: '2026-06-29', name: 'Dia do Colono Alemão / São Pedro (Petrópolis)', type: 'MUNICIPAL' as const },
  { date: '2026-09-07', name: 'Independência do Brasil', type: 'NATIONAL' as const },
  { date: '2026-10-12', name: 'Nossa Senhora Aparecida', type: 'NATIONAL' as const },
  { date: '2026-10-19', name: 'Dia do Comércio (Comerciário)', type: 'MUNICIPAL' as const },
  { date: '2026-11-02', name: 'Finados', type: 'NATIONAL' as const },
  { date: '2026-11-15', name: 'Proclamação da República', type: 'NATIONAL' as const },
  { date: '2026-11-20', name: 'Dia da Consciência Negra', type: 'NATIONAL' as const },
  { date: '2026-12-25', name: 'Natal', type: 'NATIONAL' as const },
];

export const ICONS = {
  BookOpen,
  LogOut,
  UserPlus,
  Calendar,
  Download,
  Clock
};
