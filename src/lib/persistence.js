import { createSampleWorkbookData } from '../data/sampleData'
import { supabase } from './supabase'

const MONTH_NAME_TO_NUMBER = {
  gennaio: '01',
  febbraio: '02',
  marzo: '03',
  aprile: '04',
  maggio: '05',
  giugno: '06',
  luglio: '07',
  agosto: '08',
  settembre: '09',
  ottobre: '10',
  novembre: '11',
  dicembre: '12',
}

function invariantSupabase() {
  if (!supabase) {
    throw new Error('Supabase non configurato. Controlla il file .env.')
  }
}

function parseMonthLabel(monthLabel) {
  const normalized = String(monthLabel || '').trim().toLowerCase()
  const month = Object.entries(MONTH_NAME_TO_NUMBER).find(([name]) =>
    normalized.includes(name),
  )?.[1]
  const year = normalized.match(/\b(20\d{2})\b/)?.[1]

  return {
    month: month || '07',
    year: year || '2026',
  }
}

function toIsoDate(dayMonth, monthLabel) {
  if (!dayMonth) {
    return null
  }

  const [dayText, monthText] = String(dayMonth).split('/')
  const { month, year } = parseMonthLabel(monthLabel)
  const actualMonth = monthText?.padStart(2, '0') || month
  const day = dayText?.padStart(2, '0')

  if (!day) {
    return null
  }

  return `${year}-${actualMonth}-${day}`
}

function toShortDate(isoDate) {
  if (!isoDate) {
    return ''
  }

  const [, month, day] = String(isoDate).split('-')
  return `${day}/${month}`
}

function createEmptyInserts(sellers, workingDays) {
  return Array.from({ length: workingDays }, (_, index) => ({
    day: index + 1,
    date: '',
    salesBySeller: Object.fromEntries(sellers.map((seller) => [seller.name, 0])),
    dayTotal: 0,
    cumulative: 0,
    currentAverage: 0,
    requiredAverage: 0,
    isCompleted: false,
  }))
}

function buildInsertsFromSales(salesEntries, sellers, workingDays) {
  const groupedByDate = new Map()

  salesEntries
    .slice()
    .sort((left, right) => left.sale_date.localeCompare(right.sale_date))
    .forEach((entry) => {
      const key = entry.sale_date
      const existing = groupedByDate.get(key) || {
        date: toShortDate(entry.sale_date),
        salesBySeller: Object.fromEntries(sellers.map((seller) => [seller.name, 0])),
      }

      existing.salesBySeller[entry.seller_name] =
        (existing.salesBySeller[entry.seller_name] || 0) + Number(entry.amount || 0)
      groupedByDate.set(key, existing)
    })

  const inserts = createEmptyInserts(sellers, workingDays)

  Array.from(groupedByDate.values())
    .slice(0, workingDays)
    .forEach((row, index) => {
      inserts[index] = {
        ...inserts[index],
        date: row.date,
        salesBySeller: row.salesBySeller,
        isCompleted: true,
      }
    })

  return inserts
}

function toTeamData(team, teamMonth, sellers, salesEntries, pendingEntries) {
  const normalizedSellers = sellers.map((seller) => ({
    id: seller.id,
    name: seller.name,
    target: Number(seller.target || 0),
  }))

  return {
    teamId: team.id,
    teamMonthId: teamMonth.id,
    setup: {
      teamName: team.name,
      monthLabel: teamMonth.month_label,
      targetTotal: Number(teamMonth.target_total || 0),
      workingDays: Number(teamMonth.working_days || 21),
      sellers: normalizedSellers,
    },
    inserts: buildInsertsFromSales(
      salesEntries,
      normalizedSellers,
      Number(teamMonth.working_days || 21),
    ),
    pendingRows: pendingEntries.map((entry) => ({
      id: entry.id,
      client: entry.client,
      seller: entry.seller_name,
      value: Number(entry.value || 0),
      phase: entry.phase,
      closeDate: entry.close_date ? toShortDate(entry.close_date) : '',
      notes: entry.notes,
    })),
  }
}

async function fetchTeamData(team) {
  invariantSupabase()

  const { data: teamMonth, error: monthError } = await supabase
    .from('team_months')
    .select('*')
    .eq('team_id', team.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (monthError) {
    throw monthError
  }

  if (!teamMonth) {
    return null
  }

  const [{ data: sellers, error: sellersError }, { data: salesEntries, error: salesError }, { data: pendingEntries, error: pendingError }] =
    await Promise.all([
      supabase.from('sellers').select('*').eq('team_month_id', teamMonth.id).order('created_at'),
      supabase.from('sales_entries').select('*').eq('team_month_id', teamMonth.id).order('sale_date'),
      supabase.from('pending_entries').select('*').eq('team_month_id', teamMonth.id).order('created_at'),
    ])

  if (sellersError) {
    throw sellersError
  }
  if (salesError) {
    throw salesError
  }
  if (pendingError) {
    throw pendingError
  }

  return toTeamData(team, teamMonth, sellers || [], salesEntries || [], pendingEntries || [])
}

export async function loadTeamsData(teamCount = 4) {
  invariantSupabase()

  const { data: teams, error } = await supabase
    .from('teams')
    .select('*')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw error
  }

  const existingTeams = teams || []

  if (existingTeams.length < teamCount) {
    const missingNames = Array.from({ length: teamCount - existingTeams.length }, (_, index) => {
      return `Squadra ${existingTeams.length + index + 1}`
    })

    if (missingNames.length) {
      const { error: insertError } = await supabase
        .from('teams')
        .insert(missingNames.map((name) => ({ name })))

      if (insertError) {
        throw insertError
      }

      return loadTeamsData(teamCount)
    }
  }

  const teamDataList = await Promise.all(
    existingTeams.slice(0, teamCount).map(async (team) => {
      const remoteTeamData = await fetchTeamData(team)
      if (remoteTeamData) {
        return remoteTeamData
      }

      const localDefault = createSampleWorkbookData(team.name)
      return saveTeamData({
        ...localDefault,
        teamId: team.id,
      })
    }),
  )

  return teamDataList
}

export async function saveTeamData(teamData) {
  invariantSupabase()

  let teamId = teamData.teamId

  if (!teamId) {
    const { data: insertedTeam, error: teamInsertError } = await supabase
      .from('teams')
      .insert({ name: teamData.setup.teamName })
      .select()
      .single()

    if (teamInsertError) {
      throw teamInsertError
    }

    teamId = insertedTeam.id
  } else {
    const { error: teamUpdateError } = await supabase
      .from('teams')
      .update({ name: teamData.setup.teamName })
      .eq('id', teamId)

    if (teamUpdateError) {
      throw teamUpdateError
    }
  }

  let teamMonthId = teamData.teamMonthId
  const monthPayload = {
    team_id: teamId,
    month_label: teamData.setup.monthLabel,
    working_days: teamData.setup.workingDays,
    target_total: teamData.setup.targetTotal,
  }

  if (!teamMonthId) {
    const { data: insertedMonth, error: monthInsertError } = await supabase
      .from('team_months')
      .insert(monthPayload)
      .select()
      .single()

    if (monthInsertError) {
      throw monthInsertError
    }

    teamMonthId = insertedMonth.id
  } else {
    const { error: monthUpdateError } = await supabase
      .from('team_months')
      .update(monthPayload)
      .eq('id', teamMonthId)

    if (monthUpdateError) {
      throw monthUpdateError
    }
  }

  const { error: deleteSellersError } = await supabase
    .from('sellers')
    .delete()
    .eq('team_month_id', teamMonthId)

  if (deleteSellersError) {
    throw deleteSellersError
  }

  const sellerRows = teamData.setup.sellers.map((seller) => ({
    team_month_id: teamMonthId,
    name: seller.name,
    target: seller.target,
  }))

  const { data: insertedSellers, error: insertSellersError } = await supabase
    .from('sellers')
    .insert(sellerRows)
    .select()

  if (insertSellersError) {
    throw insertSellersError
  }

  const { error: deleteSalesError } = await supabase
    .from('sales_entries')
    .delete()
    .eq('team_month_id', teamMonthId)

  if (deleteSalesError) {
    throw deleteSalesError
  }

  const salesRows = []
  teamData.inserts.forEach((row) => {
    const isoDate = toIsoDate(row.date, teamData.setup.monthLabel)
    if (!isoDate) {
      return
    }

    Object.entries(row.salesBySeller).forEach(([sellerName, amount]) => {
      const normalizedAmount = Number(amount || 0)
      if (normalizedAmount <= 0) {
        return
      }

      salesRows.push({
        team_month_id: teamMonthId,
        seller_name: sellerName,
        sale_date: isoDate,
        amount: normalizedAmount,
      })
    })
  })

  if (salesRows.length) {
    const { error: insertSalesError } = await supabase.from('sales_entries').insert(salesRows)
    if (insertSalesError) {
      throw insertSalesError
    }
  }

  const { error: deletePendingError } = await supabase
    .from('pending_entries')
    .delete()
    .eq('team_month_id', teamMonthId)

  if (deletePendingError) {
    throw deletePendingError
  }

  const pendingRows = teamData.pendingRows.map((row) => ({
    team_month_id: teamMonthId,
    client: row.client,
    seller_name: row.seller,
    phase: row.phase,
    notes: row.notes,
    value: Number(row.value || 0),
    close_date: toIsoDate(row.closeDate, teamData.setup.monthLabel),
  }))

  let insertedPending = []
  if (pendingRows.length) {
    const { data, error: insertPendingError } = await supabase
      .from('pending_entries')
      .insert(pendingRows)
      .select()

    if (insertPendingError) {
      throw insertPendingError
    }

    insertedPending = data || []
  }

  return {
    ...teamData,
    teamId,
    teamMonthId,
    setup: {
      ...teamData.setup,
      sellers: (insertedSellers || []).map((seller) => ({
        id: seller.id,
        name: seller.name,
        target: Number(seller.target || 0),
      })),
    },
    pendingRows: teamData.pendingRows.map((row, index) => ({
      ...row,
      id: insertedPending[index]?.id || row.id,
    })),
  }
}
