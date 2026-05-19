import { useState, useRef } from 'react';
import { Modal } from './Modal';

interface ImportPlanilhaProps {
  tipo: 'produtos' | 'servicos' | 'unidades';
  onSuccess?: () => void;
}

interface Loja {
  id: number;
  nomeFantasia: string;
}

export function ImportPlanilha({ tipo, onSuccess }: ImportPlanilhaProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [baixandoModelo, setBaixandoModelo] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [lojaId, setLojaId] = useState('');
  const [lojas, setLojas] = useState<Loja[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenModal = async () => {
    setModalOpen(true);
    setResultado(null);

    if (tipo === 'unidades') {
      try {
        const response = await fetch('/api/lojas', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setLojas(data);
        }
      } catch (e) {
        console.error('Erro ao carregar lojas:', e);
      }
    }
  };

  const handleBaixarModelo = async () => {
    setBaixandoModelo(true);
    try {
      const response = await fetch(`/api/importacao/modelo/${tipo}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Falha ao baixar modelo');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `modelo_importacao_${tipo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Erro ao baixar modelo: ' + err.message);
    } finally {
      setBaixandoModelo(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (tipo === 'unidades' && !lojaId) {
      alert('Selecione uma loja para importar as unidades');
      return;
    }

    setImporting(true);
    setResultado(null);

    const formData = new FormData();
    formData.append('arquivo', file);
    if (lojaId) formData.append('lojaId', lojaId);

    try {
      const response = await fetch(`/api/importacao/${tipo}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        setResultado({ sucesso: false, erro: data.error || 'Erro ao importar' });
      } else {
        setResultado(data);
        if (data.importados > 0 || data.criados > 0 || data.atualizados > 0) {
          onSuccess?.();
        }
      }
    } catch (err: any) {
      setResultado({ sucesso: false, erro: err.message || 'Erro ao importar' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const tipoLabel: Record<string, string> = {
    produtos: 'Produtos',
    servicos: 'Serviços',
    unidades: 'Unidades (Motos)'
  };

  const instrucoes: Record<string, { colunas: string[]; obs: string }> = {
    produtos: {
      colunas: ['Nome (obrigatório)', 'Tipo (Moto ou Peca)', 'Custo R$', 'Preço Venda R$', 'Margem %'],
      obs: 'O sistema detecta MOTO ou PEÇA automaticamente pelo nome caso a coluna Tipo esteja vazia. Baixe o modelo para ver os exemplos.'
    },
    servicos: {
      colunas: ['Nome (obrigatório)', 'Preço R$ (obrigatório)', 'Duração em minutos'],
      obs: 'Duração é opcional. Ex: 30, 60, 90 minutos.'
    },
    unidades: {
      colunas: ['Modelo (nome exato do produto)', 'Cor', 'Chassi', 'Motor', 'Ano'],
      obs: 'O nome do modelo deve bater exatamente com um produto cadastrado do tipo MOTO.'
    }
  };

  const info = instrucoes[tipo];

  return (
    <>
      <button onClick={handleOpenModal} className="btn btn-success">
        Importar Planilha
      </button>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Importar ${tipoLabel[tipo]}`}
      >
        <div className="space-y-4">

          {/* Instruções + botão modelo */}
          <div className="p-4 bg-zinc-800 border border-zinc-700 rounded-xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-300 mb-1">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1">
                  {info.colunas.map((col, i) => (
                    <span key={i} className="px-2 py-0.5 bg-zinc-700 text-zinc-300 text-xs rounded font-mono">
                      {col}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-2">{info.obs}</p>
              </div>
              <button
                onClick={handleBaixarModelo}
                disabled={baixandoModelo}
                className="btn btn-secondary text-xs whitespace-nowrap flex items-center gap-1.5 shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {baixandoModelo ? 'Baixando...' : 'Baixar Modelo'}
              </button>
            </div>
          </div>

          {/* Seletor de loja para unidades */}
          {tipo === 'unidades' && (
            <div>
              <label className="label">Loja de destino *</label>
              <select
                value={lojaId}
                onChange={e => setLojaId(e.target.value)}
                className="input"
                required
              >
                <option value="">Selecione uma loja</option>
                {lojas.map(l => (
                  <option key={l.id} value={l.id}>{l.nomeFantasia}</option>
                ))}
              </select>
            </div>
          )}

          {/* Upload do arquivo */}
          <div>
            <label className="label">Arquivo preenchido (XLS, XLSX ou CSV)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={handleImport}
              disabled={importing}
              className="input"
            />
          </div>

          {/* Status importação */}
          {importing && (
            <div className="p-4 bg-blue-500/20 border border-blue-500/30 rounded-xl text-center">
              <p className="text-blue-400 text-sm">Importando... Aguarde...</p>
            </div>
          )}

          {/* Resultado */}
          {resultado && (
            <div className={`p-4 rounded-xl border ${resultado.sucesso ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
              {resultado.sucesso ? (
                <div className="space-y-2">
                  {resultado.criados > 0 && (
                    <p className="text-green-400 font-medium text-sm">
                      ✓ {resultado.criados} {tipoLabel[tipo].toLowerCase()} criados
                    </p>
                  )}
                  {resultado.importados > 0 && (
                    <p className="text-green-400 font-medium text-sm">
                      ✓ {resultado.importados} {tipoLabel[tipo].toLowerCase()} importados
                    </p>
                  )}
                  {resultado.atualizados > 0 && (
                    <p className="text-blue-400 font-medium text-sm">
                      ↻ {resultado.atualizados} {tipoLabel[tipo].toLowerCase()} atualizados
                    </p>
                  )}
                  {resultado.criados === 0 && resultado.atualizados === 0 && !resultado.importados && (
                    <p className="text-yellow-400 text-sm">Nenhum registro processado.</p>
                  )}

                  {/* Colunas detectadas */}
                  {resultado.colunasDetectadas && (
                    <div className="mt-2 pt-2 border-t border-zinc-700">
                      <p className="text-xs text-zinc-500 mb-1">Colunas detectadas:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(resultado.colunasDetectadas).map(([k, v]: any) => (
                          <span key={k} className="text-xs text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                            {k}: <span className="text-zinc-300">{v}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {resultado.erros > 0 && (
                    <div className="mt-2 pt-2 border-t border-zinc-700">
                      <p className="text-yellow-400 text-sm">{resultado.erros} linhas com erro:</p>
                      <ul className="text-xs text-zinc-400 mt-1 list-disc list-inside space-y-0.5">
                        {resultado.detalhesErros?.map((err: string, i: number) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-red-400 text-sm">{resultado.erro}</p>
              )}
            </div>
          )}

          {resultado?.duplicados > 0 && (
            <div className="p-4 rounded-xl border bg-yellow-500/10 border-yellow-500/30">
              <p className="text-yellow-400 font-semibold text-sm mb-1">
                ⚠ Chassi duplicado encontrado. Verifique/corrija antes de continuar.
              </p>
              <p className="text-yellow-300/70 text-xs mb-3">
                {resultado.duplicados} chassi(s) ignorado(s) por já estarem cadastrados:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-yellow-400/70 border-b border-yellow-500/20">
                      <th className="text-left py-1 pr-3">Linha</th>
                      <th className="text-left py-1 pr-3">Modelo</th>
                      <th className="text-left py-1 pr-3">Chassi</th>
                      <th className="text-left py-1">Cadastrado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.detalhesDuplicados?.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-yellow-500/10">
                        <td className="py-1 pr-3 text-yellow-300">#{d.linha}</td>
                        <td className="py-1 pr-3 text-white">{d.modelo}</td>
                        <td className="py-1 pr-3 font-mono text-orange-300">{d.chassi}</td>
                        <td className="py-1 text-zinc-300">{d.lojaOndeEsta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={() => setModalOpen(false)} className="btn btn-secondary">
              Fechar
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
