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
    if (lojaId) {
      formData.append('lojaId', lojaId);
    }

    try {
      console.log('Enviando arquivo para /api/importacao/' + tipo);
      const response = await fetch(`/api/importacao/${tipo}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Response data:', data);
      
      if (!response.ok) {
        setResultado({
          sucesso: false,
          erro: data.error || 'Erro ao importar'
        });
      } else {
        setResultado(data);
        if (data.importados > 0 || data.criados > 0 || data.atualizados > 0) {
          onSuccess?.();
        }
      }
    } catch (err: any) {
      console.error('Erro na importacao:', err);
      setResultado({
        sucesso: false,
        erro: err.message || 'Erro ao importar'
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const tipoLabel = {
    produtos: 'Produtos',
    servicos: 'Servicos',
    unidades: 'Unidades (Motos)'
  };

  const getModeloInfo = () => {
    switch (tipo) {
      case 'produtos':
        return {
          colunas: ['Codigo', 'Produto', 'Valor de Custo', '...', 'Categoria do produto (Moto/Peca)'],
          descricao: 'Sistema gera codigo automatico (TMMOT para motos, TMPEC para pecas) e calcula preco com formula Custo / Percentual'
        };
      case 'servicos':
        return {
          colunas: ['Nome', 'Preco', 'Duracao (min)'],
          descricao: 'Duracao em minutos (15, 30, 45, 60). Deixe vazio para servicos fixos.'
        };
      case 'unidades':
        return {
          colunas: ['Produto (nome)', 'Cor', 'Chassi', 'Motor', 'Ano'],
          descricao: 'Gera codigo automatico (TMUNI00001) e vincula ao produto moto cadastrado.'
        };
      default:
        return {
          colunas: ['Dados'],
          descricao: 'Importar dados'
        };
    }
  };

  const modelo = getModeloInfo();

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
          <div className="p-4 bg-zinc-700 rounded-lg">
            <h4 className="font-medium mb-2">Formato esperado da planilha:</h4>
            <div className="text-sm text-gray-300 space-y-1">
              <p><strong>Colunas:</strong> {modelo.colunas.join(' | ')}</p>
              <p className="text-gray-400">{modelo.descricao}</p>
            </div>
          </div>

          {tipo === 'unidades' && (
            <div>
              <label className="label">Loja de destino *</label>
              <select
                value={lojaId}
                onChange={(e) => setLojaId(e.target.value)}
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

          <div>
            <label className="label">Arquivo (XLS, XLSX ou CSV)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={handleImport}
              disabled={importing}
              className="input"
            />
          </div>

          {importing && (
            <div className="p-4 bg-blue-500/20 rounded-lg text-center">
              <p className="text-blue-400">Importando... Aguarde...</p>
            </div>
          )}

          {resultado && (
            <div className={`p-4 rounded-lg ${resultado.sucesso !== false ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {resultado.sucesso !== false ? (
                <div className="space-y-2">
                  {/* Modo Lote — Unidades/Chassis */}
                  {tipo === 'unidades' ? (
                    <>
                      <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-medium mb-2">Resultado — Importação em Lote (Chassis)</p>

                      {/* Contadores principais */}
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="bg-zinc-800 rounded p-2 text-center">
                          <p className="text-green-400 font-bold text-lg">{resultado.importados || 0}</p>
                          <p className="text-xs text-zinc-400">Importados</p>
                        </div>
                        <div className="bg-zinc-800 rounded p-2 text-center">
                          <p className={`font-bold text-lg ${resultado.ignorados > 0 ? 'text-yellow-400' : 'text-zinc-500'}`}>{resultado.ignorados || 0}</p>
                          <p className="text-xs text-zinc-400">Ignorados</p>
                        </div>
                        <div className="bg-zinc-800 rounded p-2 text-center">
                          <p className={`font-bold text-lg ${resultado.erros > 0 ? 'text-red-400' : 'text-zinc-500'}`}>{resultado.erros || 0}</p>
                          <p className="text-xs text-zinc-400">Erros</p>
                        </div>
                      </div>

                      {resultado.importados === 0 && (
                        <p className="text-yellow-400 text-sm">Nenhum chassis foi importado.</p>
                      )}

                      {/* Produtos encontrados no cadastro */}
                      {resultado.produtosEncontrados?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-600">
                          <p className="text-xs text-zinc-300 font-medium mb-1">Produtos encontrados no cadastro ({resultado.produtosEncontrados.length}):</p>
                          {resultado.produtosEncontrados.map((nome: string, i: number) => (
                            <p key={i} className="text-xs text-zinc-400">• {nome}</p>
                          ))}
                        </div>
                      )}

                      {/* Produtos similares usados */}
                      {resultado.produtosSimilaresUsados?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-600">
                          <p className="text-xs text-blue-400 font-medium mb-1">Produtos similares usados ({resultado.produtosSimilaresUsados.length}):</p>
                          {resultado.produtosSimilaresUsados.map((s: any, i: number) => (
                            <p key={i} className="text-xs text-zinc-400">• Planilha: <span className="text-zinc-300">"{s.nomePlanilha}"</span> → Cadastro: <span className="text-blue-300">"{s.nomeCadastro}"</span></p>
                          ))}
                        </div>
                      )}

                      {/* Produtos criados automaticamente */}
                      {resultado.produtosCriadosAuto?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-600">
                          <p className="text-xs text-orange-400 font-medium mb-1">Produtos criados automaticamente ({resultado.produtosCriadosAuto.length}):</p>
                          {resultado.produtosCriadosAuto.map((nome: string, i: number) => (
                            <p key={i} className="text-xs text-zinc-400">• <span className="text-orange-300">{nome}</span> <span className="text-zinc-500">(tipo MOTO, custo=0 — edite o produto para ajustar valores)</span></p>
                          ))}
                        </div>
                      )}

                      {/* Estoque atualizado */}
                      {resultado.estoquesAtualizados?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-600">
                          <p className="text-xs text-zinc-300 font-medium mb-1">Estoque atualizado:</p>
                          {resultado.estoquesAtualizados.map((e: any, i: number) => (
                            <p key={i} className="text-xs text-zinc-400">{e.produto}: <span className="text-green-400 font-medium">{e.novaQuantidade} unidades</span></p>
                          ))}
                        </div>
                      )}

                      {/* Linhas ignoradas/com erro */}
                      {resultado.detalhesErros?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-600">
                          <p className="text-yellow-400 text-xs font-medium mb-1">Linhas ignoradas / com erro:</p>
                          <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                            {resultado.detalhesErros.map((err: string, i: number) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Modo Lote — Produtos ou Serviços */
                    <>
                      {(resultado.criados > 0 || resultado.importados > 0) && (
                        <p className="text-green-400 font-medium">
                          {resultado.criados || resultado.importados} {tipoLabel[tipo].toLowerCase()} criados!
                        </p>
                      )}
                      {resultado.atualizados > 0 && (
                        <p className="text-blue-400 font-medium">
                          {resultado.atualizados} {tipoLabel[tipo].toLowerCase()} atualizados!
                        </p>
                      )}
                      {resultado.criados === 0 && resultado.atualizados === 0 && !resultado.importados && (
                        <p className="text-yellow-400 font-medium">Nenhum registro processado.</p>
                      )}
                      {resultado.erros > 0 && (
                        <div className="mt-2">
                          <p className="text-yellow-400 text-sm">{resultado.erros} linhas com erro:</p>
                          <ul className="text-xs text-gray-400 mt-1 list-disc list-inside">
                            {resultado.detalhesErros?.map((err: string, i: number) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-red-400">{resultado.erro}</p>
              )}
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
