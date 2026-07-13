export function createSampleWorkbookData(teamName = 'Squadra 1') {
  return {
    setup: {
      teamName,
      monthLabel: 'Luglio 2026',
      targetTotal: 400000,
      workingDays: 21,
      sellers: [
        { id: 'seller-1', name: 'Venditore 1', target: 150000 },
        { id: 'seller-2', name: 'Venditore 2', target: 150000 },
        { id: 'seller-3', name: 'Venditore 3', target: 100000 },
      ],
    },
    inserts: [
      {
        day: 1,
        date: '01/07',
        salesBySeller: {
          'Venditore 1': 8000,
          'Venditore 2': 5000,
          'Venditore 3': 0,
        },
        isCompleted: true,
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        day: index + 2,
        date: '',
        salesBySeller: {
          'Venditore 1': 0,
          'Venditore 2': 0,
          'Venditore 3': 0,
        },
        isCompleted: false,
      })),
    ],
    pendingRows: [
      {
        client: 'Esempio Srl',
        seller: 'Venditore 1',
        value: 50000,
        phase: 'Contratto inviato',
        closeDate: '20/07',
        notes: 'Richiamare giovedi',
      },
    ],
  }
}
