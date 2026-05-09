import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';
import { api } from '../services/api';
import { Input } from './ui';
import { Button } from './ui';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

// ─── Menu structure ───────────────────────────────────────────────────────────

interface NavItem {
  type: 'item';
  id: string;
  label: string;
  icon: string;
}

interface NavGroup {
  type: 'group';
  id: string;
  label: string;
  icon: string;
  items: Omit<NavItem, 'type'>[];
}

type NavEntry = NavItem | NavGroup;

function item(id: string, label: string, icon: string): NavItem {
  return { type: 'item', id, label, icon };
}
function group(id: string, label: string, icon: string, items: Omit<NavItem, 'type'>[]): NavGroup {
  return { type: 'group', id, label, icon, items };
}

// Vendas group — Clientes incluídos dentro; Fornecedores movido para Financeiro (CRM)
const VENDAS_GROUP = (vendorLabel = 'Vendas') =>
  group('vendas-group', vendorLabel, '💰', [
    { id: 'clientes',      label: 'Clientes',                                               icon: '👤' },
    { id: 'vendas',        label: vendorLabel === 'Vendas' ? 'Vendas' : 'Minhas Vendas',    icon: '🛍️' },
    { id: 'os',            label: vendorLabel === 'Vendas' ? 'Ordens de Serviço' : 'Minhas OS', icon: '🔩' },
    { id: 'garantias',     label: 'Garantias',                                              icon: '📜' },
    { id: 'comissoes',     label: vendorLabel === 'Vendas' ? 'Comissões' : 'Minhas Comissões', icon: '💸' },
    { id: 'utilidades',    label: 'Utilidades',                                             icon: '🔄' },
  ]);

// Logística — Produtos, Serviços, Estoque
const LOGISTICA_GROUP = group('logistica-group', 'Logística', '📦', [
  { id: 'produtos',        label: 'Produtos',       icon: '🏍️' },
  { id: 'servicos',        label: 'Serviços',       icon: '🔧' },
  { id: 'estoque',         label: 'Estoque',        icon: '📋' },
  { id: 'transferencias',  label: 'Transferências', icon: '🔄' },
]);

// Cadastros completo — para ADMIN_GERAL e DONO_LOJA (gerenciam usuários)
const CADASTROS_GROUP = group('cadastros-group', 'Cadastros', '📝', [
  { id: 'usuarios',        label: 'Usuários',         icon: '👥' },
  { id: 'fin-fornecedores',label: 'Fornecedores',     icon: '🤝' },
  { id: 'fin-categorias',  label: 'Categ. / Depart.', icon: '🏷' },
]);

// Cadastros sem Usuários — para ADMIN_FINANCEIRO e GERENTE_LOJA
const CADASTROS_BASE_GROUP = group('cadastros-base-group', 'Cadastros', '📝', [
  { id: 'fin-fornecedores',label: 'Fornecedores',     icon: '🤝' },
  { id: 'fin-categorias',  label: 'Categ. / Depart.', icon: '🏷' },
]);

// Financeiro — grupo com sub-itens na barra lateral
const FIN_GROUP = group('fin-group', 'Financeiro', '💵', [
  { id: 'fin-visao-geral',    label: 'Visão Geral',   icon: '📊' },
  { id: 'fin-contas-pagar',   label: 'A Pagar',        icon: '📤' },
  { id: 'fin-contas-receber', label: 'A Receber',      icon: '📥' },
  { id: 'fin-compras',        label: 'Compras',        icon: '🛒' },
  { id: 'fin-fiscal',         label: 'Fiscal',         icon: '🧾' },
  { id: 'fin-conciliacao',    label: 'Conciliação',    icon: '🏦' },
  { id: 'fin-fornecedores',   label: 'Fornecedores',   icon: '🤝' },
  { id: 'fin-categorias',     label: 'Categorias',     icon: '🏷' },
]);

// Configurações
const CONFIG_ITEM = item('configuracoes', 'Configurações', '⚙️');

const RELATORIOS_ITEM = item('relatorios', 'Relatórios', '📈');

// Grupo de rede (franquias) — apenas ADMIN_GERAL
const REDE_GROUP = group('rede-group', 'Rede de Franquias', '🏢', [
  { id: 'grupos',              label: 'Grupos / Franquias',  icon: '🏢' },
  { id: 'lojas',               label: 'Lojas',               icon: '🏪' },
  { id: 'financeiro-empresa',  label: 'Financeiro por Loja', icon: '💰' },
]);

// Menu do Técnico — foco em OS e comissões
const TECNICO_GROUP = group('tecnico-group', 'Atendimento', '🔧', [
  { id: 'os',        label: 'Minhas OS',        icon: '🔩' },
  { id: 'garantias', label: 'Garantias',        icon: '📜' },
  { id: 'comissoes', label: 'Minhas Comissões', icon: '💸' },
]);

const menuItems: Record<string, NavEntry[]> = {
  ADMIN_GERAL: [
    item('dashboard', 'Dashboard', '📊'),
    REDE_GROUP,
    LOGISTICA_GROUP,
    CADASTROS_GROUP,
    VENDAS_GROUP(),
    FIN_GROUP,
    RELATORIOS_ITEM,
    item('log-atividades', 'Log de Atividades', '🔍'),
    CONFIG_ITEM,
  ],
  ADMIN_FINANCEIRO: [
    item('dashboard', 'Dashboard', '📊'),
    LOGISTICA_GROUP,
    CADASTROS_GROUP,
    VENDAS_GROUP(),
    FIN_GROUP,
    RELATORIOS_ITEM,
  ],
  ADMIN_REDE: [
    item('dashboard', 'Dashboard', '📊'),
    item('usuarios',  'Usuários',  '👥'),
    item('lojas',     'Lojas',     '🏪'),
    RELATORIOS_ITEM,
  ],
  DONO_LOJA: [
    item('dashboard',      'Dashboard',      '📊'),
    item('lojas',          'Lojas',          '🏪'),
    item('estoque',        'Estoque',        '📋'),
    item('transferencias', 'Transferências', '🔄'),
    CADASTROS_GROUP,
    VENDAS_GROUP(),
    FIN_GROUP,
    RELATORIOS_ITEM,
    CONFIG_ITEM,
  ],
  GERENTE_LOJA: [
    item('dashboard',      'Dashboard',      '📊'),
    item('estoque',        'Estoque',        '📋'),
    item('transferencias', 'Transferências', '🔄'),
    CADASTROS_BASE_GROUP,
    VENDAS_GROUP(),
    FIN_GROUP,
    RELATORIOS_ITEM,
  ],
  VENDEDOR: [
    item('dashboard',      'Dashboard',      '📊'),
    item('estoque',        'Estoque',        '📋'),
    item('transferencias', 'Transferências', '🔄'),
    VENDAS_GROUP('Minhas Vendas'),
  ],
  TECNICO: [
    item('dashboard', 'Dashboard', '📊'),
    item('estoque',   'Estoque',   '📋'),
    TECNICO_GROUP,
  ],
  ADMIN_COMERCIAL: [
    item('dashboard-comercial', 'Dashboard Comercial', '🛍️'),
    item('clientes',  'Clientes',  '👤'),
    item('vendas',    'Vendas',    '🛍️'),
    item('garantias', 'Garantias', '📜'),
    item('estoque',   'Estoque',   '📋'),
  ],
};

const roleLabels: Record<string, string> = {
  ADMIN_GERAL:      'Admin Geral',
  ADMIN_FINANCEIRO: 'Admin Financeiro',
  ADMIN_REDE:       'Admin Rede',
  DONO_LOJA:        'Dono de Loja',
  GERENTE_LOJA:     'Gerente',
  VENDEDOR:         'Vendedor',
  TECNICO:          'Técnico',
  ADMIN_COMERCIAL:  'Admin Comercial',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupContainsPage(g: NavGroup, page: string) {
  return g.items.some(i => i.id === page);
}

// ─── Component ────────────────────────────────────────────────────────────────

const ROLES_CAN_SELECT_LOJA = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE', 'DONO_LOJA', 'ADMIN_COMERCIAL'];


export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, logout } = useAuth();
  const { lojas, selectedLojaId, selectedLoja, setSelectedLojaId, loadingLojas } = useLojaContext();

  const handleLojaChange = (newLojaId: number | null) => {
    if (newLojaId === selectedLojaId) { setSelectorOpen(false); return; }
    const nomeDest = newLojaId === null ? 'Visão Consolidada' : (lojas.find(l => l.id === newLojaId)?.nomeFantasia || 'outra loja');
    if (!window.confirm(`Deseja realmente alterar para "${nomeDest}"?`)) return;
    setSelectedLojaId(newLojaId);
    setSelectorOpen(false);
  };
  const canSelectLoja = user?.role ? ROLES_CAN_SELECT_LOJA.includes(user.role) : false;

  const TM_IMPORTS_ROLES = ['SUPER_ADMIN', 'ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_COMERCIAL'];
  const isTMImportsView = TM_IMPORTS_ROLES.includes(user?.role || '');
  const logoSrc  = isTMImportsView ? '/logo-tm.png' : '/logo.png';
  const logoAlt  = isTMImportsView ? 'TM Imports'  : 'Tecle Motos';
  const brandName = isTMImportsView ? 'TM Imports' : 'Tecle Motos';
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [menuOpen, setMenuOpen]     = useState(false);
  const [collapsed, setCollapsed]   = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });

  // Which groups are open (by group id)
  const entries = menuItems[user?.role as keyof typeof menuItems] || menuItems.VENDEDOR;
  const initialOpen = entries
    .filter((e): e is NavGroup => e.type === 'group' && groupContainsPage(e, currentPage))
    .map(g => g.id);
  const [openGroups, setOpenGroups] = useState<string[]>(initialOpen);

  // Auto-open group when navigating into it
  useEffect(() => {
    entries.forEach(e => {
      if (e.type === 'group' && groupContainsPage(e, currentPage)) {
        setOpenGroups(prev => prev.includes(e.id) ? prev : [...prev, e.id]);
      }
    });
  }, [currentPage]);

  const [senhaModal,   setSenhaModal]   = useState(false);
  const [senhaForm,    setSenhaForm]    = useState({ senhaAtual: '', novaSenha: '', confirmar: '' });
  const [senhaErro,    setSenhaErro]    = useState('');
  const [senhaSucesso, setSenhaSucesso] = useState('');
  const [senhaLoading, setSenhaLoading] = useState(false);

  // ── Notificações: transferências pendentes ────────────────────────────────────
  const podeVerTransferencias = user?.role
    ? ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'DONO_LOJA', 'GERENTE_LOJA', 'VENDEDOR'].includes(user.role)
    : false;
  const [notifPendentes, setNotifPendentes] = useState(0);

  const buscarNotificacoes = useCallback(async () => {
    if (!podeVerTransferencias) return;
    try {
      const data = await api.get<{ pendentes: number }>('/transferencias/resumo');
      setNotifPendentes(data?.pendentes ?? 0);
    } catch {}
  }, [podeVerTransferencias]);

  useEffect(() => {
    buscarNotificacoes();
    const interval = setInterval(buscarNotificacoes, 30_000);
    return () => clearInterval(interval);
  }, [buscarNotificacoes]);

  // ── PWA install ──────────────────────────────────────────────────────────────
  const [pwaPrompt, setPwaPrompt]       = useState<any>(null);
  const [pwaInstallable, setPwaInstallable] = useState(false);
  const [showIOSInstall, setShowIOSInstall] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    if (isStandalone) return;

    const ua = navigator.userAgent;
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isiOS) { setPwaInstallable(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setPwaPrompt(e);
      setPwaInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handlePwaInstall = async () => {
    const ua = navigator.userAgent;
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isiOS) { setShowIOSInstall(true); return; }
    if (!pwaPrompt) return;
    await pwaPrompt.prompt();
    const result = await pwaPrompt.userChoice;
    if (result.outcome === 'accepted') setPwaInstallable(false);
    setPwaPrompt(null);
  };

  const handleNavigate = (page: string) => { onNavigate(page); setMenuOpen(false); };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleTrocarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setSenhaErro(''); setSenhaSucesso('');
    if (senhaForm.novaSenha !== senhaForm.confirmar) { setSenhaErro('Nova senha e confirmação não conferem'); return; }
    if (senhaForm.novaSenha.length < 8) { setSenhaErro('Nova senha deve ter no mínimo 8 caracteres'); return; }
    setSenhaLoading(true);
    try {
      const r = await fetch('/api/auth/trocar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ senhaAtual: senhaForm.senhaAtual, novaSenha: senhaForm.novaSenha, confirmarSenha: senhaForm.confirmar }),
      });
      const d = await r.json();
      if (!r.ok) { setSenhaErro(d.error || 'Erro ao trocar senha'); return; }
      setSenhaSucesso('Senha alterada com sucesso!');
      setSenhaForm({ senhaAtual: '', novaSenha: '', confirmar: '' });
      setTimeout(() => { setSenhaModal(false); setSenhaSucesso(''); }, 1500);
    } catch { setSenhaErro('Erro de conexão com o servidor'); }
    finally { setSenhaLoading(false); }
  };

  // ── Tooltip wrapper ──────────────────────────────────────────────────────────
  function Tooltip({ label, children: ch }: { label: string; children: ReactNode }) {
    return (
      <div className="relative group/tip">
        {ch}
        {collapsed && (
          <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-[70]
            opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
            <div className="bg-zinc-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-md
              whitespace-nowrap shadow-xl border border-zinc-700">
              {label}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Single nav item ──────────────────────────────────────────────────────────
  function NavBtn({ id, label, icon, indent = false }: { id: string; label: string; icon: string; indent?: boolean }) {
    const active = currentPage === id;
    return (
      <Tooltip label={label}>
        <button
          onClick={() => handleNavigate(id)}
          className={`
            w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 text-left
            ${collapsed ? 'justify-center px-0 py-2' : indent ? 'gap-2 pl-7 pr-2.5 py-1.5' : 'gap-2.5 px-2.5 py-2'}
            ${active
              ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
              : indent
                ? 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }
          `}
        >
          <span className={`shrink-0 ${indent && !collapsed ? 'text-sm' : 'text-base'}`}>{icon}</span>
          {!collapsed && <span className="truncate">{label}</span>}
        </button>
      </Tooltip>
    );
  }

  // ── Group (section) ──────────────────────────────────────────────────────────
  function NavGroupSection({ g }: { g: NavGroup }) {
    const isOpen       = openGroups.includes(g.id);
    const hasActive    = groupContainsPage(g, currentPage);

    if (collapsed) {
      // In icon-only mode: show group icon, hovering reveals a flyout panel
      return (
        <div className="relative group/flyout">
          <button
            className={`w-full flex justify-center items-center py-2 rounded-lg transition-colors
              ${hasActive ? 'text-orange-400' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
          >
            <span className="text-base">{g.icon}</span>
          </button>
          {/* Flyout */}
          <div className="pointer-events-none group-hover/flyout:pointer-events-auto
            absolute left-full top-0 ml-2.5 z-[70]
            opacity-0 group-hover/flyout:opacity-100 transition-opacity duration-150">
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1.5 min-w-44">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-3 pb-1">{g.label}</p>
              {g.items.map(it => (
                <button key={it.id}
                  onClick={() => handleNavigate(it.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors
                    ${currentPage === it.id ? 'text-orange-400' : 'text-zinc-300 hover:text-white hover:bg-zinc-700/60'}`}>
                  <span>{it.icon}</span>
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        {/* Group header */}
        <button
          onClick={() => toggleGroup(g.id)}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium
            transition-all duration-150 text-left
            ${hasActive ? 'text-orange-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
        >
          <span className="text-base shrink-0">{g.icon}</span>
          <span className="flex-1 truncate">{g.label}</span>
          <svg
            className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {/* Sub-items */}
        {isOpen && (
          <div className="mt-0.5 space-y-0.5 border-l border-zinc-700/60 ml-4">
            {g.items.map(it => (
              <NavBtn key={it.id} id={it.id} label={it.label} icon={it.icon} indent />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-zinc-950">
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300
          ${menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        bg-zinc-900 min-h-screen border-r border-zinc-800 flex flex-col
        transition-all duration-300 ease-in-out
        ${collapsed ? 'w-16' : 'w-52'}
        ${menuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className="h-14 px-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <img src={logoSrc} alt={logoAlt} className="w-8 h-8 shrink-0 object-contain" />
            {!collapsed && (
              <div className="min-w-0 hidden md:block">
                <p className="text-sm font-semibold text-white leading-tight truncate">{brandName}</p>
                <p className="text-[10px] text-orange-500 leading-tight">Sistema ERP</p>
              </div>
            )}
          </div>
          {/* Collapse toggle desktop */}
          <button onClick={toggleCollapsed} title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="hidden md:flex items-center justify-center w-7 h-7 rounded-md text-zinc-500
              hover:text-white hover:bg-zinc-800 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              }
            </svg>
          </button>
          {/* Close mobile */}
          <button onClick={() => setMenuOpen(false)}
            className="md:hidden text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {entries.map(entry =>
            entry.type === 'group'
              ? <NavGroupSection key={entry.id} g={entry} />
              : <NavBtn key={entry.id} id={entry.id} label={entry.label} icon={entry.icon} />
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 p-2 border-t border-zinc-800 space-y-1">
          {!collapsed && (
            <div className="px-2 py-2 bg-zinc-800/50 rounded-lg mb-1">
              <p className="text-xs font-semibold text-white truncate">{user?.nome}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{roleLabels[user?.role || ''] || user?.role}</p>
              {user?.loja && <p className="text-[10px] text-orange-400 mt-0.5 truncate">{user.loja.nomeFantasia}</p>}
            </div>
          )}

          {/* Instalar App (PWA) — só exibe quando sidebar expandida */}
          {pwaInstallable && !collapsed && (
            <button
              onClick={handlePwaInstall}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-orange-400 hover:text-white hover:bg-orange-500/20 transition-colors">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Instalar App</span>
            </button>
          )}

          {/* Alterar senha */}
          <Tooltip label="Alterar Senha">
            <button
              onClick={() => { setSenhaModal(true); setSenhaErro(''); setSenhaSucesso(''); setSenhaForm({ senhaAtual: '', novaSenha: '', confirmar: '' }); }}
              className={`w-full flex items-center rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors
                ${collapsed ? 'justify-center py-2.5' : 'gap-2 px-2.5 py-2'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              {!collapsed && <span>Alterar Senha</span>}
            </button>
          </Tooltip>

          {/* Sair */}
          <Tooltip label="Sair do Sistema">
            <button onClick={logout}
              className={`w-full flex items-center rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors
                ${collapsed ? 'justify-center py-2.5' : 'gap-2 px-2.5 py-2'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!collapsed && <span>Sair do Sistema</span>}
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Mobile topbar */}
        <header className="md:hidden h-14 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setMenuOpen(true)}
            className="text-zinc-400 hover:text-white p-2 -ml-2 rounded-lg hover:bg-zinc-800 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {canSelectLoja ? (
            <div className="relative">
              <button
                onClick={() => setSelectorOpen(p => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white hover:border-orange-500/50 transition-all"
              >
                <span className="text-base">{selectedLoja ? '🏪' : '🌐'}</span>
                <span className="max-w-[120px] truncate font-medium">
                  {selectedLoja ? selectedLoja.nomeFantasia : 'Consolidado'}
                </span>
                <svg className="w-3 h-3 text-zinc-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {selectorOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl z-50 py-1 min-w-[200px]">
                  <button
                    onClick={() => handleLojaChange(null)}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-zinc-700 transition-colors ${!selectedLojaId ? 'text-orange-400 font-semibold' : 'text-zinc-300'}`}
                  >
                    <span>🌐</span> Visão Consolidada
                  </button>
                  {!loadingLojas && lojas.map(loja => (
                    <button
                      key={loja.id}
                      onClick={() => handleLojaChange(loja.id)}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-zinc-700 transition-colors ${selectedLojaId === loja.id ? 'text-orange-400 font-semibold' : 'text-zinc-300'}`}
                    >
                      <span>🏪</span>
                      <span className="truncate">{loja.nomeFantasia}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <img src={logoSrc} alt={logoAlt} className="w-8 h-8 object-contain" />
              <span className="text-sm font-semibold text-white">{brandName}</span>
            </div>
          )}
          {/* Bell — mobile */}
          {podeVerTransferencias ? (
            <button
              onClick={() => { handleNavigate('transferencias'); buscarNotificacoes(); }}
              className="relative flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Transferências pendentes"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notifPendentes > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {notifPendentes > 99 ? '99+' : notifPendentes}
                </span>
              )}
            </button>
          ) : (
            <div className="w-9" />
          )}
        </header>

        {/* Desktop topbar */}
        <header className="hidden md:flex h-12 bg-zinc-900/80 backdrop-blur border-b border-zinc-800 px-5 items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <img src={logoSrc} alt={logoAlt} className="w-5 h-5 object-contain opacity-80" />
            <span>{brandName}</span>
            {selectedLoja && (
              <>
                <span className="text-zinc-700">›</span>
                <span className="text-orange-400 font-medium">{selectedLoja.nomeFantasia}</span>
              </>
            )}
          </div>

          {canSelectLoja && (
            <div className="relative">
              <button
                onClick={() => setSelectorOpen(p => !p)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm hover:border-orange-500/50 transition-all group"
              >
                <span className="text-base">{selectedLoja ? '🏪' : '🌐'}</span>
                <span className={`font-medium ${selectedLoja ? 'text-white' : 'text-zinc-300'}`}>
                  {selectedLoja ? selectedLoja.nomeFantasia : 'Visão Consolidada'}
                </span>
                {lojas.length > 0 && (
                  <span className="text-[10px] text-zinc-500 ml-0.5">({lojas.length} unid.)</span>
                )}
                <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {selectorOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSelectorOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl z-50 py-1.5 min-w-[220px]">
                    <p className="px-4 py-1 text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Selecionar unidade</p>
                    <button
                      onClick={() => handleLojaChange(null)}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 hover:bg-zinc-700/60 transition-colors ${!selectedLojaId ? 'text-orange-400 font-semibold' : 'text-zinc-300'}`}
                    >
                      <span>🌐</span>
                      <div>
                        <p className="leading-tight">Visão Consolidada</p>
                        <p className="text-[10px] text-zinc-500 leading-tight">Todas as unidades</p>
                      </div>
                      {!selectedLojaId && <span className="ml-auto text-orange-500">✓</span>}
                    </button>
                    {lojas.length > 0 && <div className="border-t border-zinc-700/60 my-1" />}
                    {loadingLojas ? (
                      <div className="px-4 py-3 text-xs text-zinc-500">Carregando...</div>
                    ) : lojas.map(loja => (
                      <button
                        key={loja.id}
                        onClick={() => handleLojaChange(loja.id)}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 hover:bg-zinc-700/60 transition-colors ${selectedLojaId === loja.id ? 'text-orange-400 font-semibold' : 'text-zinc-300'}`}
                      >
                        <span>🏪</span>
                        <div className="min-w-0 flex-1">
                          <p className="leading-tight truncate">{loja.nomeFantasia}</p>
                          <p className="text-[10px] text-zinc-500 leading-tight truncate">{loja.cnpj || loja.razaoSocial}</p>
                        </div>
                        {selectedLojaId === loja.id && <span className="ml-auto text-orange-500 shrink-0">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {!canSelectLoja && user?.loja && (
            <div className="flex items-center gap-2 px-3 py-1 bg-zinc-800 rounded-lg border border-zinc-700 text-xs text-zinc-400">
              <span>🏪</span>
              <span className="font-medium text-zinc-300">{user.loja.nomeFantasia}</span>
            </div>
          )}

          {/* Bell — desktop */}
          {podeVerTransferencias && (
            <button
              onClick={() => { handleNavigate('transferencias'); buscarNotificacoes(); }}
              className="relative ml-2 flex items-center justify-center w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title={notifPendentes > 0 ? `${notifPendentes} transferência(s) aguardando aprovação` : 'Transferências'}
            >
              <svg className="w-4.5 h-4.5" style={{ width: '1.125rem', height: '1.125rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notifPendentes > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none animate-pulse">
                  {notifPendentes > 99 ? '99+' : notifPendentes}
                </span>
              )}
            </button>
          )}
        </header>

        <main className="flex-1 p-4 md:p-5 overflow-y-auto bg-zinc-950">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Modal Alterar Senha */}
      {senhaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={() => setSenhaModal(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-4">Alterar Senha</h2>
            <form onSubmit={handleTrocarSenha} className="space-y-4">
              <Input label="Senha Atual" type="password" value={senhaForm.senhaAtual}
                onChange={e => setSenhaForm({ ...senhaForm, senhaAtual: e.target.value })} required />
              <Input label="Nova Senha" type="password" value={senhaForm.novaSenha}
                onChange={e => setSenhaForm({ ...senhaForm, novaSenha: e.target.value })}
                hint="Mínimo 8 caracteres" required />
              <Input label="Confirmar Nova Senha" type="password" value={senhaForm.confirmar}
                onChange={e => setSenhaForm({ ...senhaForm, confirmar: e.target.value })} required />
              {senhaErro    && <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">{senhaErro}</div>}
              {senhaSucesso && <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-sm">{senhaSucesso}</div>}
              <div className="flex gap-3">
                <Button type="button" variant="secondary" fullWidth onClick={() => setSenhaModal(false)}>Cancelar</Button>
                <Button type="submit" variant="primary" fullWidth loading={senhaLoading}>Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Instalar no iOS */}
      {showIOSInstall && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
          onClick={() => setShowIOSInstall(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}>
            <div className="text-center mb-5">
              <span className="text-4xl">📱</span>
              <h3 className="text-lg font-bold text-white mt-2">Instalar no iPhone / iPad</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="bg-orange-500/20 text-orange-400 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                <p className="text-sm text-zinc-300">
                  Toque no ícone de <strong className="text-white">Compartilhar</strong> (quadrado com seta ↑) na barra inferior do Safari
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="bg-orange-500/20 text-orange-400 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                <p className="text-sm text-zinc-300">
                  Role a lista e toque em <strong className="text-white">"Adicionar à Tela de Início"</strong>
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="bg-orange-500/20 text-orange-400 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
                <p className="text-sm text-zinc-300">
                  Confirme tocando em <strong className="text-white">"Adicionar"</strong> no canto superior direito
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowIOSInstall(false)}
              className="w-full mt-6 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
            >
              Entendido!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
