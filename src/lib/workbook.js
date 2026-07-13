let xlsxLoader

function createSellerId(index) {
  return `seller-${index + 1}`
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return value
  }

  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')

  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function sheetToRows(sheet) {
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  })
}

function findSheet(workbook, matcher) {
  const name = workbook.SheetNames.find((sheetName) => matcher(normalizeText(sheetName)))
  return name ? workbook.Sheets[name] : null
}

function findRowIndex(rows, matcher) {
  return rows.findIndex((row) => row.some((cell) => matcher(normalizeText(cell))))
}

function findValueOnRight(rows, labelMatcher) {
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      if (labelMatcher(normalizeText(row[index]))) {
        for (let cursor = index + 1; cursor < row.length; cursor += 1) {
          if (String(row[cursor] || '').trim()) {
            return row[cursor]
          }
        }
      }
    }
  }

  return ''
}

function parseSetupSheet(sheet) {
  const rows = sheetToRows(sheet)
  const teamName = String(
    findValueOnRight(rows, (value) => value.includes('nome squadra')) || 'Squadra vendite',
  )
  const monthLabel = String(findValueOnRight(rows, (value) => value === 'mese') || 'Mese attivo')
  const targetTotal = parseNumber(
    findValueOnRight(rows, (value) => value.includes('obiettivo del mese')),
  )
  const workingDays = parseNumber(
    findValueOnRight(rows, (value) => value.includes('giorni lavorativi')),
  )

  const sellerHeaderIndex = findRowIndex(
    rows,
    (value) => value === 'venditore' || value.includes('venditori e obiettivi'),
  )

  const sellers = []

  if (sellerHeaderIndex >= 0) {
    for (let index = sellerHeaderIndex + 1; index < rows.length; index += 1) {
      const row = rows[index]
      const name = String(row[0] || '').trim()
      const target = parseNumber(row[1])
      const normalizedName = normalizeText(name)

      if (!name || normalizedName.includes('somma obiettivi')) {
        break
      }

      sellers.push({ id: createSellerId(sellers.length), name, target })
    }
  }

  if (!sellers.length) {
    throw new Error(
      'Non riesco a leggere i venditori dal foglio Setup. Controlla che la tabella abbia le colonne Venditore e Obiettivo.',
    )
  }

  return {
    teamName,
    monthLabel,
    targetTotal,
    workingDays,
    sellers,
  }
}

function parseInsertSheet(sheet, sellerNames, workingDays) {
  const rows = sheetToRows(sheet)
  const headerIndex = findRowIndex(rows, (value) => value === 'giorno')

  if (headerIndex < 0) {
    throw new Error('Non trovo la tabella Giorno/Data nel foglio Inserimento.')
  }

  const headers = rows[headerIndex].map((value) => normalizeText(value))
  const dayIndex = headers.findIndex((value) => value === 'giorno')
  const dateIndex = headers.findIndex((value) => value === 'data')
  const totalIndex = headers.findIndex((value) => value.includes('totale giorno'))
  const cumulativeIndex = headers.findIndex((value) => value.includes('cumulato'))
  const avgIndex = headers.findIndex((value) => value.includes('media a oggi'))
  const requiredAvgIndex = headers.findIndex((value) => value.includes('da domani'))

  const sellerIndexes = sellerNames.map((seller) => ({
    name: seller,
    index: headers.findIndex((value) => value === normalizeText(seller)),
  }))

  const inserts = []

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const day = parseNumber(row[dayIndex])

    if (!day) {
      continue
    }

    const salesBySeller = {}
    let hasData = false

    sellerIndexes.forEach(({ name, index }) => {
      const value = index >= 0 ? parseNumber(row[index]) : 0
      salesBySeller[name] = value
      if (value > 0) {
        hasData = true
      }
    })

    const date = String(row[dateIndex] || '').trim()
    if (date) {
      hasData = true
    }

    inserts.push({
      day,
      date,
      salesBySeller,
      dayTotal: totalIndex >= 0 ? parseNumber(row[totalIndex]) : 0,
      cumulative: cumulativeIndex >= 0 ? parseNumber(row[cumulativeIndex]) : 0,
      currentAverage: avgIndex >= 0 ? parseNumber(row[avgIndex]) : 0,
      requiredAverage: requiredAvgIndex >= 0 ? parseNumber(row[requiredAvgIndex]) : 0,
      isCompleted: hasData,
    })
  }

  if (!inserts.length) {
    for (let day = 1; day <= workingDays; day += 1) {
      inserts.push({
        day,
        date: '',
        salesBySeller: Object.fromEntries(sellerNames.map((seller) => [seller, 0])),
        dayTotal: 0,
        cumulative: 0,
        currentAverage: 0,
        requiredAverage: 0,
        isCompleted: false,
      })
    }
  }

  return inserts
}

function parsePendingSheet(sheet) {
  const rows = sheetToRows(sheet)
  const headerIndex = findRowIndex(rows, (value) => value === 'cliente')

  if (headerIndex < 0) {
    return []
  }

  const headers = rows[headerIndex].map((value) => normalizeText(value))
  const clientIndex = headers.findIndex((value) => value === 'cliente')
  const sellerIndex = headers.findIndex((value) => value === 'venditore')
  const valueIndex = headers.findIndex((value) => value.includes('valore'))
  const phaseIndex = headers.findIndex((value) => value === 'fase')
  const closeDateIndex = headers.findIndex((value) => value.includes('chiusura'))
  const notesIndex = headers.findIndex((value) => value === 'note')

  const pendingRows = []

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const client = String(row[clientIndex] || '').trim()
    const seller = String(row[sellerIndex] || '').trim()
    const value = parseNumber(row[valueIndex])
    const phase = String(row[phaseIndex] || '').trim()
    const closeDate = String(row[closeDateIndex] || '').trim()
    const notes = String(row[notesIndex] || '').trim()

    if (!client && !seller && !value && !phase && !closeDate && !notes) {
      continue
    }

    pendingRows.push({
      client: client || 'Trattativa senza nome',
      seller: seller || 'Non assegnato',
      value,
      phase: phase || 'Da definire',
      closeDate,
      notes,
    })
  }

  return pendingRows
}

function fillDerivedInsertValues(inserts, targetTotal, workingDays) {
  let cumulative = 0
  let completedDays = 0

  return inserts.map((row) => {
    const dayTotal =
      row.dayTotal || Object.values(row.salesBySeller).reduce((sum, value) => sum + value, 0)

    if (row.isCompleted) {
      completedDays += 1
      cumulative += dayTotal
    }

    const currentAverage = completedDays > 0 ? cumulative / completedDays : 0
    const remainingDays = Math.max(workingDays - completedDays, 0)
    const requiredAverage =
      remainingDays > 0 ? Math.max(targetTotal - cumulative, 0) / remainingDays : 0

    return {
      ...row,
      dayTotal,
      cumulative: row.cumulative || cumulative,
      currentAverage: row.currentAverage || currentAverage,
      requiredAverage: row.requiredAverage || requiredAverage,
    }
  })
}

async function getXlsx() {
  if (!xlsxLoader) {
    xlsxLoader = import('xlsx')
  }

  return xlsxLoader
}

export async function parseWorkbook(buffer) {
  const xlsx = await getXlsx()
  const workbook = xlsx.read(buffer, { type: 'array' })
  const setupSheet =
    findSheet(workbook, (name) => name.includes('setup')) || workbook.Sheets[workbook.SheetNames[0]]
  const setup = parseSetupSheet(setupSheet)

  const insertSheet = findSheet(
    workbook,
    (name) => name.includes('inserimento') || name.includes('vendite'),
  )
  const pendingSheet = findSheet(workbook, (name) => name.includes('pending'))

  if (!insertSheet) {
    throw new Error('Manca il foglio Inserimento nel file Excel.')
  }

  const inserts = fillDerivedInsertValues(
    parseInsertSheet(
      insertSheet,
      setup.sellers.map((seller) => seller.name),
      setup.workingDays,
    ),
    setup.targetTotal,
    setup.workingDays,
  )

  return {
    setup,
    inserts,
    pendingRows: pendingSheet ? parsePendingSheet(pendingSheet) : [],
  }
}

export function deriveDashboardData(workbookData) {
  const { setup, pendingRows } = workbookData
  const inserts = fillDerivedInsertValues(
    workbookData.inserts,
    setup.targetTotal,
    setup.workingDays,
  )
  const completedRows = inserts.filter((row) => row.isCompleted)
  const completedDays = completedRows.length
  const soldTotal = completedRows.at(-1)?.cumulative || 0
  const pendingValue = pendingRows.reduce((sum, row) => sum + row.value, 0)
  const salesBySeller = setup.sellers.map((seller) => {
    const sold = completedRows.reduce(
      (sum, row) => sum + (row.salesBySeller[seller.name] || 0),
      0,
    )

    return {
      ...seller,
      sold,
    }
  })

  const summary = {
    soldTotal,
    targetTotal: setup.targetTotal,
    missingTotal: Math.max(setup.targetTotal - soldTotal, 0),
    progress: setup.targetTotal > 0 ? soldTotal / setup.targetTotal : 0,
    completedDays,
    remainingDays: Math.max(setup.workingDays - completedDays, 0),
    expectedProgress: setup.workingDays > 0 ? completedDays / setup.workingDays : 0,
    currentDaily: completedDays > 0 ? soldTotal / completedDays : 0,
    targetDaily: setup.workingDays > 0 ? setup.targetTotal / setup.workingDays : 0,
    targetWeekly:
      setup.workingDays > 0 ? (setup.targetTotal / setup.workingDays) * 5 : 0,
    requiredDaily:
      setup.workingDays - completedDays > 0
        ? Math.max(setup.targetTotal - soldTotal, 0) / (setup.workingDays - completedDays)
        : 0,
    monthProjection:
      completedDays > 0 ? (soldTotal / completedDays) * setup.workingDays : 0,
    pendingValue,
    pendingCount: pendingRows.length,
    pendingCoverage:
      setup.targetTotal > 0 ? (soldTotal + pendingValue) / setup.targetTotal : 0,
  }

  const teamRows = salesBySeller.map((seller) => ({
    ...seller,
    missing: Math.max(seller.target - seller.sold, 0),
    progress: seller.target > 0 ? seller.sold / seller.target : 0,
    dailyAverage: completedDays > 0 ? seller.sold / completedDays : 0,
  }))

  const cards = [
    {
      label: 'Obiettivo del mese',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.targetTotal),
      caption: 'Target complessivo del team',
      tone: 'tone-dark',
    },
    {
      label: 'Venduto finora',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.soldTotal),
      caption: 'Cumulato aggiornato',
      tone: 'tone-green',
    },
    {
      label: "Manca all'obiettivo",
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.missingTotal),
      caption: 'Gap residuo da chiudere',
      tone: 'tone-orange',
    },
    {
      label: 'Avanzamento',
      value: `${Math.round(summary.progress * 100)}%`,
      caption: 'Percentuale del target raggiunta',
      tone: 'tone-sky',
    },
    {
      label: 'Media/giorno da tenere',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.targetDaily),
      caption: 'Ritmo ideale giornaliero',
      tone: 'tone-muted',
    },
    {
      label: 'Media/giorno attuale',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.currentDaily),
      caption: 'Venduto medio per giorno compilato',
      tone: 'tone-muted',
    },
    {
      label: 'Nuova media richiesta',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.requiredDaily),
      caption: 'Media da tenere da domani',
      tone: 'tone-muted',
    },
    {
      label: 'Media settimanale target',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.targetWeekly),
      caption: 'Target teorico su 5 giorni',
      tone: 'tone-muted',
    },
    {
      label: 'Giorni rimasti',
      value: String(summary.remainingDays),
      caption: 'Giorni lavorativi ancora aperti',
      tone: 'tone-muted',
    },
    {
      label: 'Proiezione fine mese',
      value: new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(summary.monthProjection),
      caption: 'Se mantenete il ritmo attuale',
      tone: 'tone-muted',
    },
    {
      label: 'Giorni compilati',
      value: String(summary.completedDays),
      caption: 'Righe giornaliere valorizzate',
      tone: 'tone-muted',
    },
  ]

  return {
    setup,
    inserts,
    pendingRows,
    salesBySeller,
    summary,
    cards,
    teamRows,
  }
}
