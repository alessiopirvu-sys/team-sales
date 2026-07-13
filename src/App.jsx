import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { createSampleWorkbookData } from './data/sampleData'
import { deriveDashboardData } from './lib/workbook'
import { loadTeamsData, saveTeamData } from './lib/persistence'
import { isSupabaseConfigured } from './lib/supabase'

const TEAM_COUNT = 4
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'setup', label: 'Setup mese' },
  { id: 'inserimenti', label: 'Inserimenti' },
  { id: 'pending', label: 'Pending' },
]

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value || 0)
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`
}

function formatDateForInput(value) {
  const parts = String(value || '').split('/')
  if (parts.length !== 2) {
    return ''
  }

  const [day, month] = parts
  return `2026-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function formatDateFromInput(value) {
  const parts = String(value || '').split('-')
  if (parts.length !== 3) {
    return ''
  }

  const [, month, day] = parts
  return `${day}/${month}`
}

function createSellerId(index = 0) {
  return `seller-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`
}

function cloneSellerDrafts(sellers) {
  return sellers.map((seller, index) => ({
    id: seller.id || createSellerId(index),
    name: seller.name,
    target: seller.target,
  }))
}

function syncInsertsWithSetup(inserts, sellers, workingDays) {
  const sellerNames = sellers.map((seller) => seller.name)
  const syncedRows = Array.from({ length: workingDays }, (_, index) => {
    const existingRow = inserts[index]
    const baseSales = Object.fromEntries(sellerNames.map((sellerName) => [sellerName, 0]))

    if (!existingRow) {
      return {
        day: index + 1,
        date: '',
        salesBySeller: baseSales,
        dayTotal: 0,
        cumulative: 0,
        currentAverage: 0,
        requiredAverage: 0,
        isCompleted: false,
      }
    }

    const salesBySeller = Object.fromEntries(
      sellerNames.map((sellerName) => [sellerName, existingRow.salesBySeller[sellerName] || 0]),
    )

    return {
      ...existingRow,
      day: index + 1,
      salesBySeller,
    }
  })

  return syncedRows
}

function Modal({ title, isOpen, onClose, children }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h4>{title}</h4>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function getStatusTone(summary) {
  if (summary.progress >= summary.expectedProgress + 0.03) {
    return {
      label: 'In vantaggio',
      className: 'banner-positive',
      text: 'State correndo sopra ritmo: mantenete il passo.',
    }
  }

  if (summary.progress >= Math.max(summary.expectedProgress - 0.03, 0)) {
    return {
      label: 'In linea',
      className: 'banner-neutral',
      text: 'Siete in traiettoria: ancora qualche chiusura e il target resta alla portata.',
    }
  }

  return {
    label: 'Sotto ritmo',
    className: 'banner-warning',
    text: 'Oggi e nei prossimi giorni serve piu spinta commerciale per rientrare sul target.',
  }
}

function getPageFromHash(hash) {
  const normalized = String(hash || '').replace(/^#/, '')
  return NAV_ITEMS.some((item) => item.id === normalized) ? normalized : 'dashboard'
}

function createInitialTeams() {
  return Array.from({ length: TEAM_COUNT }, (_, index) =>
    createSampleWorkbookData(`Squadra ${index + 1}`),
  )
}

function HomePage({ teams, onSelectTeam }) {
  return (
    <main className="home-page">
      <section className="home-shell">
        <div className="home-header">
          <span className="eyebrow">Team sales</span>
          <h1>Seleziona la tua squadra</h1>
          <p>
            Ogni team entra nella propria area dedicata con setup, inserimenti,
            dashboard e pending separati.
          </p>
        </div>

        <div className="home-grid">
          {teams.map((team, index) => (
            <button
              key={`${team.setup.teamName}-${index}`}
              type="button"
              className="home-team-card"
              onClick={() => onSelectTeam(index)}
            >
              <span className="home-team-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{team.setup.teamName}</strong>
              <p>{team.setup.monthLabel}</p>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

function LoadingPage({ message }) {
  return (
    <main className="home-page">
      <section className="home-shell">
        <div className="home-header">
          <span className="eyebrow">Team sales</span>
          <h1>Sto caricando i dati</h1>
          <p>{message}</p>
        </div>
      </section>
    </main>
  )
}

function DashboardPage({ cards, teamRows, pendingRows, summary, salesBySeller }) {
  return (
    <>
      <section className="stats-grid">
        {cards.map((card) => (
          <article key={card.label} className={`stat-card ${card.tone}`}>
            <span className="stat-label">{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.caption}</p>
          </article>
        ))}
      </section>

      <section className="panel-grid">
        <article className="panel wide-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Squadra</span>
              <h3>Obiettivi personali visibili a tutti</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venditore</th>
                  <th>Obiettivo</th>
                  <th>Venduto</th>
                  <th>Manca</th>
                  <th>% obiettivo</th>
                  <th>Media/giorno</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{formatCurrency(row.target)}</td>
                    <td>{formatCurrency(row.sold)}</td>
                    <td>{formatCurrency(row.missing)}</td>
                    <td>{formatPercent(row.progress)}</td>
                    <td>{formatCurrency(row.dailyAverage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Pending</span>
              <h3>Quello che avete gia in canna</h3>
            </div>
          </div>
          <div className="pending-summary">
            <div>
              <span>Totale pending</span>
              <strong>{formatCurrency(summary.pendingValue)}</strong>
            </div>
            <div>
              <span>Contratti aperti</span>
              <strong>{summary.pendingCount}</strong>
            </div>
            <div>
              <span>Venduto + pending</span>
              <strong>{formatPercent(summary.pendingCoverage)}</strong>
            </div>
          </div>
          <div className="mini-list">
            {pendingRows.slice(0, 5).map((row) => (
              <div key={`${row.client}-${row.notes}`} className="mini-row">
                <div>
                  <strong>{row.client}</strong>
                  <span>{row.seller}</span>
                </div>
                <div>
                  <strong>{formatCurrency(row.value)}</strong>
                  <span>{row.phase}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel-grid lower-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Classifica</span>
              <h3>Venduto per venditore</h3>
            </div>
          </div>
          <div className="sales-breakdown">
            {salesBySeller.map((seller) => (
              <div key={seller.name}>
                <span>{seller.name}</span>
                <strong>{formatCurrency(seller.sold)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Sintesi</span>
              <h3>Andamento del mese</h3>
            </div>
          </div>
          <div className="definition-grid single-column">
            <div>
              <dt>Media giornaliera target</dt>
              <dd>{formatCurrency(summary.targetDaily)}</dd>
            </div>
            <div>
              <dt>Media giornaliera attuale</dt>
              <dd>{formatCurrency(summary.currentDaily)}</dd>
            </div>
            <div>
              <dt>Nuova media richiesta</dt>
              <dd>{formatCurrency(summary.requiredDaily)}</dd>
            </div>
            <div>
              <dt>Proiezione fine mese</dt>
              <dd>{formatCurrency(summary.monthProjection)}</dd>
            </div>
          </div>
        </article>
      </section>
    </>
  )
}

function SetupPage({
  setup,
  summary,
  teamRows,
  setupDraft,
  sellerDrafts,
  isEditingSetup,
  isEditingSellers,
  onStartSetupEdit,
  onSaveSetupEdit,
  onStartSellersEdit,
  onSaveSellersEdit,
  onSetupDraftChange,
  onSellerDraftChange,
  onAddSellerDraft,
  onRemoveSellerDraft,
}) {
  return (
    <section className="panel-stack">
      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Setup</span>
            <h3>Parametri del mese</h3>
          </div>
          <button
            type="button"
            className={isEditingSetup ? 'button-primary' : 'button-secondary'}
            onClick={isEditingSetup ? onSaveSetupEdit : onStartSetupEdit}
          >
            {isEditingSetup ? 'Salva' : 'Modifica'}
          </button>
        </div>
        <div className="definition-grid">
          {isEditingSetup ? (
            <label className="field-card">
              <span>Nome squadra</span>
              <input
                type="text"
                value={setupDraft.teamName}
                onChange={(event) => onSetupDraftChange('teamName', event.target.value)}
              />
            </label>
          ) : (
            <div className="field-card readonly-card">
              <span>Nome squadra</span>
              <strong>{setup.teamName}</strong>
            </div>
          )}
          {isEditingSetup ? (
            <label className="field-card">
              <span>Mese</span>
              <input
                type="text"
                value={setupDraft.monthLabel}
                onChange={(event) => onSetupDraftChange('monthLabel', event.target.value)}
              />
            </label>
          ) : (
            <div className="field-card readonly-card">
              <span>Mese</span>
              <strong>{setup.monthLabel}</strong>
            </div>
          )}
          <div className="field-card readonly-card">
            <span>Obiettivo totale</span>
            <strong>{formatCurrency(setup.targetTotal)}</strong>
          </div>
          {isEditingSetup ? (
            <label className="field-card">
              <span>Giorni lavorativi</span>
              <input
                type="number"
                min="1"
                value={setupDraft.workingDays}
                onChange={(event) => onSetupDraftChange('workingDays', event.target.value)}
              />
            </label>
          ) : (
            <div className="field-card readonly-card">
              <span>Giorni lavorativi</span>
              <strong>{setup.workingDays}</strong>
            </div>
          )}
          <div className="field-card readonly-card">
            <span>Media giornaliera da tenere</span>
            <strong>{formatCurrency(summary.targetDaily)}</strong>
          </div>
          <div className="field-card readonly-card">
            <span>Media settimanale da tenere</span>
            <strong>{formatCurrency(summary.targetWeekly)}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Obiettivi personali</span>
            <h3>Distribuzione per venditore</h3>
          </div>
          <div className="panel-actions">
            {isEditingSellers && (
              <button type="button" className="button-secondary" onClick={onAddSellerDraft}>
                Aggiungi venditore
              </button>
            )}
            <button
              type="button"
              className={isEditingSellers ? 'button-primary' : 'button-secondary'}
              onClick={isEditingSellers ? onSaveSellersEdit : onStartSellersEdit}
            >
              {isEditingSellers ? 'Salva' : 'Modifica'}
            </button>
          </div>
        </div>
        {isEditingSellers ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venditore</th>
                  <th>Obiettivo</th>
                  <th>Venduto</th>
                  <th>Scostamento</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sellerDrafts.map((seller, index) => {
                  const row = teamRows.find((teamRow) => teamRow.id === seller.id)
                  const sold = row?.sold || 0

                  return (
                    <tr key={seller.id}>
                      <td>
                        <input
                          className="table-input"
                          type="text"
                          value={seller.name}
                          onChange={(event) =>
                            onSellerDraftChange(index, 'name', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="table-input table-input-number"
                          type="number"
                          min="0"
                          step="1"
                          value={seller.target}
                          onChange={(event) =>
                            onSellerDraftChange(index, 'target', event.target.value)
                          }
                        />
                      </td>
                      <td>{formatCurrency(sold)}</td>
                      <td>{formatCurrency(Math.max(Number(seller.target || 0) - sold, 0))}</td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => onRemoveSellerDraft(index)}
                          disabled={sellerDrafts.length <= 1}
                        >
                          Rimuovi
                        </button>
                      </td>
                    </tr>
                  )
                })}
	              </tbody>
	            </table>
	          </div>
	        ) : (
	          <div className="table-wrap">
	            <table>
	              <thead>
	                <tr>
	                  <th>Venditore</th>
	                  <th>Obiettivo</th>
	                  <th>Venduto</th>
	                  <th>Scostamento</th>
	                </tr>
	              </thead>
	              <tbody>
	                {teamRows.map((row) => (
	                  <tr key={row.id}>
	                    <td>{row.name}</td>
	                    <td>{formatCurrency(row.target)}</td>
	                    <td>{formatCurrency(row.sold)}</td>
	                    <td>{formatCurrency(row.target - row.sold)}</td>
	                  </tr>
	                ))}
	              </tbody>
	            </table>
	          </div>
	        )}
	      </article>
    </section>
  )
}

function InserimentiPage({
  inserts,
  summary,
  salesBySeller,
  saleForm,
  onSaleFormChange,
  onSaleSubmit,
  onToggleSaleForm,
}) {
  return (
    <section className="panel-stack">
      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Inserimento giornaliero</span>
            <h3>Andamento del mese</h3>
          </div>
        </div>
        <div className="sparkline-wrap" aria-hidden="true">
          {inserts.map((row) => {
            const height = Math.max(
              12,
              summary.soldTotal > 0 ? Math.round((row.dayTotal / summary.soldTotal) * 180) : 12,
            )

            return (
              <span
                key={row.day}
                className={`spark-bar ${row.isCompleted ? 'is-complete' : ''}`}
                style={{ height: `${height}px` }}
                title={`Giorno ${row.day}: ${formatCurrency(row.dayTotal)}`}
              />
            )
          })}
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Tabella inserimenti</span>
            <h3>Dettaglio giorni compilati</h3>
          </div>
          <button type="button" className="button-accent" onClick={onToggleSaleForm}>
            + Nuova vendita
          </button>
        </div>
        <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  {salesBySeller.map((seller) => (
                    <th key={seller.name}>{seller.name}</th>
                  ))}
                  <th>Totale</th>
                  <th>Cumulato</th>
                </tr>
              </thead>
              <tbody>
                {inserts.map((row) => (
                  <tr key={`${row.day}-${row.date}`}>
                    <td>{row.date || '-'}</td>
                    {salesBySeller.map((seller) => (
                      <td key={`${row.day}-${seller.name}`}>
                      {formatCurrency(row.salesBySeller[seller.name] || 0)}
                    </td>
                    ))}
                    <td>{formatCurrency(row.dayTotal)}</td>
                    <td>{formatCurrency(row.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
          </table>
        </div>
      </article>

      <Modal title="Nuova vendita" isOpen={saleForm.isOpen} onClose={onToggleSaleForm}>
        <form className="modal-form" onSubmit={onSaleSubmit}>
          <label className="field-card">
            <span>Venditore</span>
            <select
              value={saleForm.seller}
              onChange={(event) => onSaleFormChange('seller', event.target.value)}
            >
              {salesBySeller.map((seller) => (
                <option key={seller.name} value={seller.name}>
                  {seller.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-card">
            <span>Data</span>
            <input
              type="date"
              value={saleForm.date}
              onChange={(event) => onSaleFormChange('date', event.target.value)}
            />
          </label>
          <label className="field-card">
            <span>Quanto hanno venduto</span>
            <input
              type="number"
              min="0"
              step="1"
              value={saleForm.amount}
              onChange={(event) => onSaleFormChange('amount', event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="submit" className="button-primary">
              Salva vendita
            </button>
          </div>
        </form>
      </Modal>
    </section>
  )
}

function PendingPage({
  pendingRows,
  summary,
  sellerOptions,
  pendingForm,
  onPendingFormChange,
  onPendingSubmit,
  onTogglePendingForm,
  onRemovePending,
}) {
  return (
    <section className="panel-stack">
      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Pending</span>
            <h3>Contratti aperti da chiudere</h3>
          </div>
        </div>
        <div className="pending-summary">
          <div>
            <span>Totale pending</span>
            <strong>{formatCurrency(summary.pendingValue)}</strong>
          </div>
          <div>
            <span>N. contratti</span>
            <strong>{summary.pendingCount}</strong>
          </div>
          <div>
            <span>Copertura obiettivo</span>
            <strong>{formatPercent(summary.pendingCoverage)}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Tabella pending</span>
            <h3>Pipeline trattative</h3>
          </div>
          <button type="button" className="button-accent" onClick={onTogglePendingForm}>
            + Nuovo pending
          </button>
        </div>
        <div className="table-wrap compact-table">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Venditore</th>
                <th>Valore</th>
                <th>Fase</th>
                <th>Chiusura</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((row, index) => (
                <tr key={`${row.client}-${row.closeDate}-${row.notes}-${index}`}>
                  <td>{row.client}</td>
                  <td>{row.seller}</td>
                  <td>{formatCurrency(row.value)}</td>
                  <td>{row.phase}</td>
                  <td>{row.closeDate || '-'}</td>
                  <td>{row.notes || '-'}</td>
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onRemovePending(index)}
                    >
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <Modal title="Nuovo pending" isOpen={pendingForm.isOpen} onClose={onTogglePendingForm}>
        <form className="modal-form" onSubmit={onPendingSubmit}>
          <label className="field-card">
            <span>Cliente</span>
            <input
              type="text"
              value={pendingForm.client}
              onChange={(event) => onPendingFormChange('client', event.target.value)}
            />
          </label>
          <label className="field-card">
            <span>Venditore</span>
            <select
              value={pendingForm.seller}
              onChange={(event) => onPendingFormChange('seller', event.target.value)}
            >
              {sellerOptions.map((seller) => (
                <option key={seller} value={seller}>
                  {seller}
                </option>
              ))}
            </select>
          </label>
          <label className="field-card">
            <span>Fase</span>
            <input
              type="text"
              value={pendingForm.phase}
              onChange={(event) => onPendingFormChange('phase', event.target.value)}
            />
          </label>
          <label className="field-card">
            <span>Note</span>
            <input
              type="text"
              value={pendingForm.notes}
              onChange={(event) => onPendingFormChange('notes', event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="submit" className="button-primary">
              Salva pending
            </button>
          </div>
        </form>
      </Modal>
    </section>
  )
}

function App() {
  const [teamsData, setTeamsData] = useState(() => createInitialTeams())
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(null)
  const [isLoadingRemote, setIsLoadingRemote] = useState(true)
  const [isEditingSetup, setIsEditingSetup] = useState(false)
  const [isEditingSellers, setIsEditingSellers] = useState(false)
  const [setupDraft, setSetupDraft] = useState(() => ({
    teamName: 'Squadra 1',
    monthLabel: 'Luglio 2026',
    workingDays: 21,
  }))
  const [sellerDrafts, setSellerDrafts] = useState(() =>
    cloneSellerDrafts(createInitialTeams()[0].setup.sellers),
  )
  const [feedback, setFeedback] = useState({
    type: 'info',
    message: 'Dashboard pronta all’uso. Puoi aggiornare setup, vendite e pending direttamente da qui.',
  })
  const [currentPage, setCurrentPage] = useState(() => getPageFromHash(window.location.hash))
  const workbookData = teamsData[selectedTeamIndex ?? 0]
  const [saleForm, setSaleForm] = useState({
    isOpen: false,
    seller: workbookData.setup.sellers[0]?.name || '',
    date: formatDateForInput(workbookData.inserts.find((row) => row.date)?.date) || '2026-07-01',
    amount: '',
  })
  const [pendingForm, setPendingForm] = useState({
    isOpen: false,
    client: '',
    seller: workbookData.setup.sellers[0]?.name || '',
    phase: '',
    notes: '',
  })
  const dashboardData = useMemo(() => deriveDashboardData(workbookData), [workbookData])

  useEffect(() => {
    let isCancelled = false

    async function bootstrapRemoteData() {
      if (!isSupabaseConfigured) {
        if (!isCancelled) {
          setFeedback({
            type: 'error',
            message: 'Supabase non configurato: uso i dati locali finche non completiamo il collegamento.',
          })
          setIsLoadingRemote(false)
        }
        return
      }

      try {
        const remoteTeams = await loadTeamsData(TEAM_COUNT)
        if (!isCancelled) {
          setTeamsData(remoteTeams)
          setFeedback({
            type: 'success',
            message: 'Dati caricati da Supabase. Le modifiche ora sono condivise tra dispositivi.',
          })
        }
      } catch (error) {
        if (!isCancelled) {
          setFeedback({
            type: 'error',
            message:
              error instanceof Error
                ? `Errore Supabase: ${error.message}`
                : 'Errore Supabase: continuo con i dati locali.',
          })
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingRemote(false)
        }
      }
    }

    bootstrapRemoteData()

    return () => {
      isCancelled = true
    }
  }, [])

  const persistCurrentTeam = async (nextTeamData, successMessage) => {
    if (!isSupabaseConfigured || selectedTeamIndex == null || !nextTeamData) {
      if (successMessage) {
        setFeedback({
          type: 'success',
          message: successMessage,
        })
      }
      return
    }

    try {
      const savedTeamData = await saveTeamData(nextTeamData)
      setTeamsData((current) =>
        current.map((teamData, index) =>
          index === selectedTeamIndex ? savedTeamData : teamData,
        ),
      )

      if (successMessage) {
        setFeedback({
          type: 'success',
          message: successMessage,
        })
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error
            ? `Salvataggio su Supabase fallito: ${error.message}`
            : 'Salvataggio su Supabase fallito.',
      })
    }
  }

  const applyCurrentTeamUpdate = async (updater, successMessage) => {
    if (selectedTeamIndex == null) {
      return
    }

    const currentTeamData = teamsData[selectedTeamIndex]
    if (!currentTeamData) {
      return
    }

    const nextTeamData = updater(currentTeamData)

    setTeamsData((current) =>
      current.map((teamData, index) =>
        index === selectedTeamIndex ? nextTeamData : teamData,
      ),
    )

    await persistCurrentTeam(nextTeamData, successMessage)
  }

  useEffect(() => {
    if (!isEditingSetup) {
      setSetupDraft({
        teamName: workbookData.setup.teamName,
        monthLabel: workbookData.setup.monthLabel,
        workingDays: workbookData.setup.workingDays,
      })
    }
  }, [isEditingSetup, workbookData.setup.monthLabel, workbookData.setup.teamName, workbookData.setup.workingDays])

  useEffect(() => {
    if (!isEditingSellers) {
      setSellerDrafts(cloneSellerDrafts(workbookData.setup.sellers))
    }
  }, [isEditingSellers, workbookData.setup.sellers])

  useEffect(() => {
    const syncPageFromHash = () => {
      setCurrentPage(getPageFromHash(window.location.hash))
    }

    window.addEventListener('hashchange', syncPageFromHash)
    return () => window.removeEventListener('hashchange', syncPageFromHash)
  }, [])

  useEffect(() => {
    if (!workbookData.setup.sellers.some((seller) => seller.name === saleForm.seller)) {
      setSaleForm((current) => ({
        ...current,
        seller: workbookData.setup.sellers[0]?.name || '',
      }))
    }
  }, [saleForm.seller, workbookData.setup.sellers])

  useEffect(() => {
    if (!workbookData.setup.sellers.some((seller) => seller.name === pendingForm.seller)) {
      setPendingForm((current) => ({
        ...current,
        seller: workbookData.setup.sellers[0]?.name || '',
      }))
    }
  }, [pendingForm.seller, workbookData.setup.sellers])

  useEffect(() => {
    if (!saleForm.isOpen && !pendingForm.isOpen) {
      return undefined
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        if (saleForm.isOpen) {
          setSaleForm((current) => ({ ...current, isOpen: false }))
        }
        if (pendingForm.isOpen) {
          setPendingForm((current) => ({ ...current, isOpen: false }))
        }
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [pendingForm.isOpen, saleForm.isOpen])

  const handleNavigate = (pageId) => {
    window.location.hash = pageId
  }

  const handleSelectTeam = (teamIndex) => {
    const nextTeam = teamsData[teamIndex]
    setSelectedTeamIndex(teamIndex)
    setCurrentPage(getPageFromHash(window.location.hash))
    setIsEditingSetup(false)
    setIsEditingSellers(false)
    setSaleForm({
      isOpen: false,
      seller: nextTeam.setup.sellers[0]?.name || '',
      date: formatDateForInput(nextTeam.inserts.find((row) => row.date)?.date) || '2026-07-01',
      amount: '',
    })
    setPendingForm({
      isOpen: false,
      client: '',
      seller: nextTeam.setup.sellers[0]?.name || '',
      phase: '',
      notes: '',
    })
  }

  const handleBackToHome = () => {
    setSelectedTeamIndex(null)
    setIsEditingSetup(false)
    setIsEditingSellers(false)
    setSaleForm((current) => ({ ...current, isOpen: false }))
    setPendingForm((current) => ({ ...current, isOpen: false }))
  }

  const handleStartSetupEdit = () => {
    setSetupDraft({
      teamName: workbookData.setup.teamName,
      monthLabel: workbookData.setup.monthLabel,
      workingDays: workbookData.setup.workingDays,
    })
    setIsEditingSetup(true)
  }

  const handleSetupDraftChange = (field, value) => {
    setSetupDraft((current) => ({
      ...current,
      [field]: field === 'workingDays' ? value : value,
    }))
  }

  const handleSaveSetupEdit = async () => {
    await applyCurrentTeamUpdate((current) => {
      return {
        ...current,
        setup: {
          ...current.setup,
          teamName: setupDraft.teamName.trim() || current.setup.teamName,
          monthLabel: setupDraft.monthLabel.trim() || current.setup.monthLabel,
          workingDays: Math.max(1, Number.parseInt(setupDraft.workingDays, 10) || 1),
        },
        inserts: syncInsertsWithSetup(
          current.inserts,
          current.setup.sellers,
          Math.max(1, Number.parseInt(setupDraft.workingDays, 10) || 1),
        ),
      }
    }, 'Parametri del mese salvati.')
    setIsEditingSetup(false)
  }

  const handleStartSellersEdit = () => {
    setSellerDrafts(cloneSellerDrafts(workbookData.setup.sellers))
    setIsEditingSellers(true)
  }

  const handleSellerDraftChange = (index, field, value) => {
    setSellerDrafts((current) =>
      current.map((seller, sellerIndex) =>
        sellerIndex === index
          ? {
              ...seller,
              [field]: field === 'target' ? value : value,
            }
          : seller,
      ),
    )
  }

  const handleAddSellerDraft = () => {
    setSellerDrafts((current) => [
      ...current,
      {
        id: createSellerId(current.length),
        name: `Venditore ${current.length + 1}`,
        target: 0,
      },
    ])
  }

  const handleRemoveSellerDraft = (index) => {
    setSellerDrafts((current) => current.filter((_, sellerIndex) => sellerIndex !== index))
  }

  const handleSaveSellersEdit = async () => {
    await applyCurrentTeamUpdate((current) => {
      const sanitizedSellers = sellerDrafts.map((seller, index) => ({
        id: seller.id || createSellerId(index),
        name: seller.name.trim() || `Venditore ${index + 1}`,
        target: Math.max(0, Number.parseInt(seller.target, 10) || 0),
      }))
      const previousSellersById = new Map(
        current.setup.sellers.map((seller) => [seller.id || seller.name, seller]),
      )
      const removedSellerNames = current.setup.sellers
        .filter(
          (seller) => !sanitizedSellers.some((nextSeller) => nextSeller.id === (seller.id || seller.name)),
        )
        .map((seller) => seller.name)
      const targetTotal = sanitizedSellers.reduce((sum, seller) => sum + seller.target, 0)

      return {
        ...current,
        setup: {
          ...current.setup,
          sellers: sanitizedSellers,
          targetTotal,
        },
        inserts: syncInsertsWithSetup(
          current.inserts.map((row) => {
            const nextSalesBySeller = {}

            sanitizedSellers.forEach((seller) => {
              const previousSeller = previousSellersById.get(seller.id)
              const previousName = previousSeller?.name || seller.name
              nextSalesBySeller[seller.name] = row.salesBySeller[previousName] || 0
            })

            return {
              ...row,
              salesBySeller: nextSalesBySeller,
            }
          }),
          sanitizedSellers,
          current.setup.workingDays,
        ),
        pendingRows: current.pendingRows
          .filter((row) => !removedSellerNames.includes(row.seller))
          .map((row) => {
            const matchingSeller = sanitizedSellers.find((seller) => {
              const previousSeller = previousSellersById.get(seller.id)
              return previousSeller?.name === row.seller
            })

            return matchingSeller ? { ...row, seller: matchingSeller.name } : row
          }),
      }
    }, 'Obiettivi personali salvati.')
    setIsEditingSellers(false)
  }

  const handleSaleFormChange = (field, value) => {
    setSaleForm((current) => ({ ...current, [field]: value }))
  }

  const handleToggleSaleForm = () => {
    setSaleForm((current) => ({
      ...current,
      isOpen: !current.isOpen,
      seller: current.seller || workbookData.setup.sellers[0]?.name || '',
    }))
  }

  const handlePendingFormChange = (field, value) => {
    setPendingForm((current) => ({ ...current, [field]: value }))
  }

  const handleTogglePendingForm = () => {
    setPendingForm((current) => ({
      ...current,
      isOpen: !current.isOpen,
      seller: current.seller || workbookData.setup.sellers[0]?.name || '',
    }))
  }

  const handlePendingSubmit = async (event) => {
    event.preventDefault()

    const client = pendingForm.client.trim()
    const seller = pendingForm.seller.trim()
    const phase = pendingForm.phase.trim()
    const notes = pendingForm.notes.trim()

    if (!client || !seller || !phase || !notes) {
      setFeedback({
        type: 'error',
        message: 'Per inserire un nuovo pending servono cliente, venditore, fase e note.',
      })
      return
    }

    await applyCurrentTeamUpdate((current) => ({
      ...current,
      pendingRows: [
        ...current.pendingRows,
        {
          client,
          seller,
          value: 0,
          phase,
          closeDate: '',
          notes,
        },
      ],
    }), `Pending salvato: ${client} assegnato a ${seller}.`)

    setPendingForm({
      isOpen: false,
      client: '',
      seller: workbookData.setup.sellers[0]?.name || '',
      phase: '',
      notes: '',
    })
  }

  const handleRemovePending = async (index) => {
    await applyCurrentTeamUpdate((current) => ({
      ...current,
      pendingRows: current.pendingRows.filter((_, pendingIndex) => pendingIndex !== index),
    }), 'Cliente rimosso dal pending.')
  }

  const handleSaleSubmit = async (event) => {
    event.preventDefault()

    const amount = Math.max(0, Number.parseInt(saleForm.amount, 10) || 0)
    const formattedDate = formatDateFromInput(saleForm.date)

    if (!saleForm.seller || !formattedDate || amount <= 0) {
      setFeedback({
        type: 'error',
        message: 'Per inserire una vendita servono venditore, data e importo maggiore di zero.',
      })
      return
    }

    let didInsert = false

    await applyCurrentTeamUpdate((current) => {
      let targetIndex = current.inserts.findIndex((row) => row.date === formattedDate)

      if (targetIndex < 0) {
        targetIndex = current.inserts.findIndex((row) => !row.date)
      }

      if (targetIndex < 0) {
        return current
      }

      didInsert = true

      const nextInserts = current.inserts.map((row, index) => {
        if (index !== targetIndex) {
          return row
        }

        return {
          ...row,
          date: formattedDate,
          isCompleted: true,
          salesBySeller: {
            ...row.salesBySeller,
            [saleForm.seller]: (row.salesBySeller[saleForm.seller] || 0) + amount,
          },
        }
      })

      return {
        ...current,
        inserts: nextInserts,
      }
    }, `Vendita salvata: ${saleForm.seller}, ${formattedDate}, ${formatCurrency(amount)}.`)

    if (!didInsert) {
      setFeedback({
        type: 'error',
        message: 'Non ci sono piu righe disponibili negli inserimenti per aggiungere una nuova vendita.',
      })
      return
    }

    setSaleForm((current) => ({
      ...current,
      isOpen: false,
      amount: '',
    }))
  }

  const { setup, teamRows, pendingRows, inserts, summary, cards, salesBySeller } = dashboardData
  const statusTone = getStatusTone(summary)

  const pageMeta = useMemo(() => {
    switch (currentPage) {
      case 'setup':
        return {
          eyebrow: 'Setup mese',
          title: `${setup.teamName} — Parametri del mese`,
          subtitle:
            'Questa pagina replica il foglio Setup con dati base, obiettivi personali e medie target.',
        }
      case 'inserimenti':
        return {
          eyebrow: 'Inserimenti',
          title: `${setup.teamName} — Inserimento giornaliero`,
          subtitle:
            'Qui trovi la vista dedicata al foglio Inserimento con dettaglio completo delle righe giornaliere.',
        }
      case 'pending':
        return {
          eyebrow: 'Pending',
          title: `${setup.teamName} — Pipeline contratti`,
          subtitle:
            'Questa pagina raccoglie solo i contratti aperti e la copertura che danno all’obiettivo del mese.',
        }
      default:
        return {
          eyebrow: 'Dashboard vendite',
          title: `${setup.teamName} — ${setup.monthLabel}`,
          subtitle:
            'Replica web del cruscotto Google Sheet con gli stessi KPI, obiettivi personali, inserimenti giornalieri e pending.',
        }
    }
  }, [currentPage, setup.monthLabel, setup.teamName])

  if (isLoadingRemote) {
    return <LoadingPage message="Sto sincronizzando squadre, setup, vendite e pending da Supabase." />
  }

  if (selectedTeamIndex == null) {
    return <HomePage teams={teamsData} onSelectTeam={handleSelectTeam} />
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <p className="brand-kicker">team sales</p>
            <h1>Control room</h1>
          </div>
        </div>

        <button type="button" className="sidebar-home-link" onClick={handleBackToHome}>
          ← Torna alle squadre
        </button>

        <nav className="sidebar-nav" aria-label="Dashboard pages">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={currentPage === item.id ? 'active' : ''}
              onClick={() => handleNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-panel">
          <span className="eyebrow">Mese attivo</span>
          <strong>{setup.monthLabel}</strong>
          <p>{setup.teamName}</p>
        </div>

        <div className="sidebar-panel">
          <span className="eyebrow">Obiettivo team</span>
          <strong>{formatCurrency(setup.targetTotal)}</strong>
          <p>{setup.teamName}</p>
        </div>
      </aside>

      <main className="content">
        <section className="hero-card">
          <div>
            <span className="eyebrow">{pageMeta.eyebrow}</span>
            <h2>{pageMeta.title}</h2>
            <p className="subtitle">{pageMeta.subtitle}</p>
          </div>
          <div className={`banner ${statusTone.className}`}>
            <strong>{statusTone.label}</strong>
            <span>{statusTone.text}</span>
          </div>

          <div
            className={`feedback feedback-${feedback.type}`}
            role="status"
            aria-live="polite"
          >
            {feedback.message}
          </div>
        </section>

        {currentPage === 'dashboard' && (
          <DashboardPage
            cards={cards}
            teamRows={teamRows}
            pendingRows={pendingRows}
            summary={summary}
            salesBySeller={salesBySeller}
          />
        )}

        {currentPage === 'setup' && (
          <SetupPage
            setup={setup}
            summary={summary}
            teamRows={teamRows}
            setupDraft={setupDraft}
            sellerDrafts={sellerDrafts}
            isEditingSetup={isEditingSetup}
            isEditingSellers={isEditingSellers}
            onStartSetupEdit={handleStartSetupEdit}
            onSaveSetupEdit={handleSaveSetupEdit}
            onStartSellersEdit={handleStartSellersEdit}
            onSaveSellersEdit={handleSaveSellersEdit}
            onSetupDraftChange={handleSetupDraftChange}
            onSellerDraftChange={handleSellerDraftChange}
            onAddSellerDraft={handleAddSellerDraft}
            onRemoveSellerDraft={handleRemoveSellerDraft}
          />
        )}

        {currentPage === 'inserimenti' && (
          <InserimentiPage
            inserts={inserts}
            summary={summary}
            salesBySeller={salesBySeller}
            saleForm={saleForm}
            onSaleFormChange={handleSaleFormChange}
            onSaleSubmit={handleSaleSubmit}
            onToggleSaleForm={handleToggleSaleForm}
          />
        )}

        {currentPage === 'pending' && (
          <PendingPage
            pendingRows={pendingRows}
            summary={summary}
            sellerOptions={salesBySeller.map((seller) => seller.name)}
            pendingForm={pendingForm}
            onPendingFormChange={handlePendingFormChange}
            onPendingSubmit={handlePendingSubmit}
            onTogglePendingForm={handleTogglePendingForm}
            onRemovePending={handleRemovePending}
          />
        )}
      </main>
    </div>
  )
}

export default App
