import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';
import { buscarCNPJ } from '../services/cnpj';
import { formatCPF, formatCNPJ } from '../services/cnpj';

interface Cliente {
  id: number;
  nome: string;
  cpfCnpj: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

const initialForm = {
  id: 0,
  nome: '',
  cpfCnpj: '',
  telefone: '',
  email: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  estado: ''
};

function formatarDocumento(doc: string): string {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return formatCPF(d);
  if (d.length === 14) return formatCNPJ(d);
  return doc;
}

export function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [formErro, setFormErro] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [buscandoDoc, setBuscandoDoc] = useState(false);
  const [buscaTexto, setBuscaTexto] = useState('');
  const docRef = useRef<string>('');

  const loadClientes = () => {
    setLoading(true);
    api.get<Cliente[]>('/clientes')
      .then(setClientes)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadClientes(); }, []);

  const buscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setBuscandoCep(true);
    try {
      const data = await api.get<{ cep: string; logradouro: string; bairro: string; cidade: string; estado: string }>(
        `/clientes/buscar-cep/${cepLimpo}`
      );
      setForm(prev => ({
        ...prev,
        cep: data.cep,
        logradouro: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.cidade || '',
        estado: data.estado || ''
      }));
    } catch {
      // CEP não encontrado — usuário preenche manualmente
    } finally {
      setBuscandoCep(false);
    }
  };

  const handleDocumentoBlur = async (valor: string) => {
    const doc = valor.replace(/\D/g, '');
    docRef.current = doc;
    if (doc.length < 11) return;

    setBuscandoDoc(true);
    setFormErro('');
    try {
      // 1. Buscar no banco interno
      const encontrado = await api.get<Cliente>(`/clientes/por-documento/${doc}`).catch(() => null);
      if (encontrado) {
        if (editando && encontrado.id === form.id) {
          // Mesmo cliente, edição normal
        } else {
          setFormErro(
            `${doc.length === 11 ? 'CPF' : 'CNPJ'} já cadastrado para: ${encontrado.nome}. Não é possível duplicar.`
          );
          setBuscandoDoc(false);
          return;
        }
      }

      // 2. Se CNPJ e não encontrado no banco, buscar na BrasilAPI
      if (doc.length === 14 && !encontrado) {
        const cnpjData = await buscarCNPJ(doc);
        if (cnpjData) {
          setForm(prev => ({
            ...prev,
            nome: prev.nome || cnpjData.razaoSocial,
            telefone: prev.telefone || cnpjData.telefone,
            email: prev.email || cnpjData.email,
            cep: prev.cep || cnpjData.cep.replace(/\D/g, ''),
            bairro: prev.bairro || cnpjData.bairro,
            cidade: prev.cidade || cnpjData.cidade,
            estado: prev.estado || cnpjData.uf
          }));
          // Buscar CEP para preencher logradouro se veio da BrasilAPI
          if (cnpjData.cep) await buscarCep(cnpjData.cep);
        }
      }
    } finally {
      setBuscandoDoc(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro('');

    if (!form.cpfCnpj.trim()) {
      setFormErro('CPF/CNPJ é obrigatório.');
      return;
    }

    const doc = form.cpfCnpj.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      setFormErro('CPF deve ter 11 dígitos e CNPJ deve ter 14 dígitos.');
      return;
    }

    setSaving(true);
    try {
      if (editando && form.id) {
        await api.put(`/clientes/${form.id}`, form);
      } else {
        await api.post('/clientes', form);
      }
      setModalOpen(false);
      setForm(initialForm);
      setFormErro('');
      setEditando(false);
      loadClientes();
    } catch (err: any) {
      setFormErro(err.message || 'Erro ao salvar cliente');
    } finally {
      setSaving(false);
    }
  };

  const handleEditar = (cliente: Cliente) => {
    setForm({
      id: cliente.id,
      nome: cliente.nome,
      cpfCnpj: cliente.cpfCnpj || '',
      telefone: cliente.telefone || '',
      email: cliente.email || '',
      cep: cliente.cep || '',
      logradouro: cliente.logradouro || '',
      numero: cliente.numero || '',
      complemento: cliente.complemento || '',
      bairro: cliente.bairro || '',
      cidade: cliente.cidade || '',
      estado: cliente.estado || ''
    });
    setFormErro('');
    setEditando(true);
    setModalOpen(true);
  };

  const handleExcluir = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este cliente?')) return;
    try {
      await api.delete(`/clientes/${id}`);
      loadClientes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExcluirSelecionados = async () => {
    if (selecionados.length === 0) return;
    if (!window.confirm(`Tem certeza que deseja excluir ${selecionados.length} cliente(s)?`)) return;
    try {
      await Promise.all(selecionados.map(id => api.delete(`/clientes/${id}`)));
      setSelecionados([]);
      loadClientes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const abrirNovo = () => {
    setForm(initialForm);
    setFormErro('');
    setEditando(false);
    setModalOpen(true);
  };

  const clientesFiltrados = buscaTexto
    ? clientes.filter(c =>
        c.nome.toLowerCase().includes(buscaTexto.toLowerCase()) ||
        (c.cpfCnpj || '').includes(buscaTexto.replace(/\D/g, '')) ||
        (c.telefone || '').includes(buscaTexto) ||
        (c.cidade || '').toLowerCase().includes(buscaTexto.toLowerCase())
      )
    : clientes;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Carregando...</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Clientes</h1>
        <div className="flex flex-wrap gap-2">
          {selecionados.length > 0 && (
            <button onClick={handleExcluirSelecionados} className="btn btn-danger">
              Excluir ({selecionados.length})
            </button>
          )}
          <button onClick={abrirNovo} className="btn btn-primary">+ Novo Cliente</button>
        </div>
      </div>

      <div className="mb-4">
        <input
          value={buscaTexto}
          onChange={e => setBuscaTexto(e.target.value)}
          placeholder="Buscar por nome, CPF/CNPJ, telefone ou cidade..."
          className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500"
        />
      </div>

      {clientesFiltrados.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          {clientes.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente corresponde à busca'}
        </div>
      ) : (
        <div className="space-y-3">
          {clientesFiltrados.map(cliente => (
            <div key={cliente.id} className="card">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selecionados.includes(cliente.id)}
                  onChange={() => setSelecionados(prev =>
                    prev.includes(cliente.id) ? prev.filter(x => x !== cliente.id) : [...prev, cliente.id]
                  )}
                  className="rounded mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-white truncate">{cliente.nome}</h3>
                    <div className="flex gap-2">
                      {cliente.telefone && (
                        <a
                          href={`https://wa.me/55${cliente.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá, ${cliente.nome.split(' ')[0]}! Tudo bem? Passando da Tecle Motos para verificar se podemos ajudá-lo. 😊`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm"
                          style={{ backgroundColor: '#16a34a', color: 'white' }}
                          title="Enviar WhatsApp"
                        >
                          💬
                        </a>
                      )}
                      <button onClick={() => handleEditar(cliente)} className="btn btn-sm btn-secondary">Editar</button>
                      <button onClick={() => handleExcluir(cliente.id)} className="btn btn-sm btn-danger">Excluir</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">CPF/CNPJ: </span>
                      <span className="text-gray-300 font-mono">{cliente.cpfCnpj ? formatarDocumento(cliente.cpfCnpj) : '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Telefone: </span>
                      <span className="text-gray-300">{cliente.telefone || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Cidade: </span>
                      <span className="text-gray-300">{cliente.cidade && cliente.estado ? `${cliente.cidade}/${cliente.estado}` : '-'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setFormErro(''); }} title={editando ? 'Editar Cliente' : 'Novo Cliente'}>
        <form onSubmit={handleSubmit} className="space-y-4">

          {formErro && (
            <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-400">
              {formErro}
            </div>
          )}

          {/* CPF/CNPJ — primeiro campo, com auto-fill */}
          <div>
            <label className="label">CPF / CNPJ *</label>
            <div className="relative">
              <input
                type="text"
                value={form.cpfCnpj}
                onChange={e => { setForm({ ...form, cpfCnpj: e.target.value }); setFormErro(''); }}
                onBlur={e => handleDocumentoBlur(e.target.value)}
                className="input"
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                required
              />
              {buscandoDoc && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">
                  buscando...
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              CNPJ: preenchimento automático via Receita Federal. CPF: verifica duplicidade.
            </p>
          </div>

          <div>
            <label className="label">Nome *</label>
            <input
              type="text"
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              className="input"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Telefone</label>
              <input
                type="text"
                value={form.telefone}
                onChange={e => setForm({ ...form, telefone: e.target.value })}
                className="input"
                placeholder="(00) 00000-0000"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="border-t border-zinc-700 pt-4">
            <h3 className="font-semibold mb-3 text-sm text-zinc-400">Endereço</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">CEP</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.cep}
                    onChange={e => setForm({ ...form, cep: e.target.value })}
                    onBlur={e => buscarCep(e.target.value)}
                    className="input"
                    placeholder="00000-000"
                    maxLength={9}
                  />
                  {buscandoCep && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">...</span>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Logradouro</label>
                <input
                  type="text"
                  value={form.logradouro}
                  onChange={e => setForm({ ...form, logradouro: e.target.value })}
                  className="input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
              <div>
                <label className="label">Número</label>
                <input
                  type="text"
                  value={form.numero}
                  onChange={e => setForm({ ...form, numero: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Complemento</label>
                <input
                  type="text"
                  value={form.complemento}
                  onChange={e => setForm({ ...form, complemento: e.target.value })}
                  className="input"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Bairro</label>
                <input
                  type="text"
                  value={form.bairro}
                  onChange={e => setForm({ ...form, bairro: e.target.value })}
                  className="input"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
              <div className="sm:col-span-2">
                <label className="label">Cidade</label>
                <input
                  type="text"
                  value={form.cidade}
                  onChange={e => setForm({ ...form, cidade: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Estado</label>
                <input
                  type="text"
                  value={form.estado}
                  onChange={e => setForm({ ...form, estado: e.target.value })}
                  className="input"
                  maxLength={2}
                  placeholder="UF"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => { setModalOpen(false); setFormErro(''); }} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || buscandoDoc}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
