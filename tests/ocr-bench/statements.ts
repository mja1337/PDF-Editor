export type StatementRow = {
  date: string
  description: string
  paidOut?: string
  paidIn?: string
  balance: string
}

export type BankStatement = {
  id: string
  bank: string
  subtitle: string
  holder: string
  address: string[]
  sortCode: string
  accountNumber: string
  iban: string
  period: string
  issued: string
  rows: StatementRow[]
}

export const BANK_STATEMENTS: BankStatement[] = [
  {
    id: 'northbridge-current',
    bank: 'Northbridge Bank plc',
    subtitle: 'Personal Current Account Statement',
    holder: 'Mr Alex Rivera',
    address: ['14 Harbour Lane', 'Leeds', 'LS1 4AB'],
    sortCode: '40-12-88',
    accountNumber: '12345678',
    iban: 'GB29 NBRG 4012 8812 3456 78',
    period: '01 Jan 2026 - 31 Jan 2026',
    issued: '02 Feb 2026',
    rows: [
      { date: '01 Jan', description: 'Opening balance', balance: '2,418.66' },
      { date: '03 Jan', description: 'TESCO STORES 3842', paidOut: '54.21', balance: '2,364.45' },
      { date: '05 Jan', description: 'SALARY ACME ROBOTICS LTD', paidIn: '2,150.00', balance: '4,514.45' },
      { date: '07 Jan', description: 'SO SOUTHERN ELECTRIC', paidOut: '86.40', balance: '4,428.05' },
      { date: '09 Jan', description: 'CARD PAYMENT PRET A MANGER', paidOut: '8.95', balance: '4,419.10' },
      { date: '12 Jan', description: 'DIRECT DEBIT THAMES WATER', paidOut: '32.18', balance: '4,386.92' },
      { date: '14 Jan', description: 'ATM WITHDRAWAL LEEDS STN', paidOut: '50.00', balance: '4,336.92' },
      { date: '18 Jan', description: 'FASTER PAYMENT TO J RIVERA', paidOut: '200.00', balance: '4,136.92' },
      { date: '21 Jan', description: 'REFUND AMAZON EU SARL', paidIn: '27.49', balance: '4,164.41' },
      { date: '24 Jan', description: 'CARD PAYMENT NATIONAL RAIL', paidOut: '64.80', balance: '4,099.61' },
      { date: '28 Jan', description: 'DD NETFLIX INTERNATIONAL', paidOut: '15.99', balance: '4,083.62' },
      { date: '31 Jan', description: 'Closing balance', balance: '4,083.62' },
    ],
  },
  {
    id: 'harbour-savings',
    bank: 'Harbour Mutual Savings',
    subtitle: 'Instant Access Savings Statement',
    holder: 'Ms Priya Shah',
    address: ['9 Quayside Court', 'Bristol', 'BS1 6NY'],
    sortCode: '77-04-21',
    accountNumber: '00918473',
    iban: 'GB11 HBRM 7704 2100 9184 73',
    period: '01 Dec 2025 - 31 Dec 2025',
    issued: '03 Jan 2026',
    rows: [
      { date: '01 Dec', description: 'Opening balance', balance: '12,040.00' },
      { date: '04 Dec', description: 'TRANSFER FROM CURRENT A/C', paidIn: '500.00', balance: '12,540.00' },
      { date: '11 Dec', description: 'INTEREST PAID GROSS', paidIn: '18.27', balance: '12,558.27' },
      { date: '16 Dec', description: 'WITHDRAWAL TO CURRENT A/C', paidOut: '250.00', balance: '12,308.27' },
      { date: '22 Dec', description: 'FASTER PAYMENT FROM R SHAH', paidIn: '1,200.00', balance: '13,508.27' },
      { date: '31 Dec', description: 'Closing balance', balance: '13,508.27' },
    ],
  },
]

export type ScanProfileId = 'light-scan' | 'heavy-scan'

export type ScanProfile = {
  id: ScanProfileId
  rotateDeg: number
  scale: number
  blurPx: number
  contrast: number
  brightness: number
  jpegQuality: number
  grain: number
  speckle: number
  paperTint: number
  vignette: number
  streaks: number
}

export const SCAN_PROFILES: ScanProfile[] = [
  {
    id: 'light-scan',
    rotateDeg: 0.4,
    scale: 1.018,
    blurPx: 0.35,
    contrast: 0.93,
    brightness: 1.04,
    jpegQuality: 0.7,
    grain: 16,
    speckle: 0.005,
    paperTint: 0.1,
    vignette: 0.16,
    streaks: 3,
  },
  {
    id: 'heavy-scan',
    rotateDeg: 0.8,
    scale: 1.022,
    blurPx: 0.55,
    contrast: 0.86,
    brightness: 1.06,
    jpegQuality: 0.55,
    grain: 22,
    speckle: 0.008,
    paperTint: 0.13,
    vignette: 0.22,
    streaks: 4,
  },
]

export function moneyValues(statement: BankStatement) {
  return statement.rows.flatMap((row) =>
    [row.paidOut, row.paidIn, row.balance].filter((value): value is string => Boolean(value)),
  )
}

export function statementPlainText(statement: BankStatement) {
  const header = [
    statement.bank,
    statement.subtitle,
    `Issued ${statement.issued}`,
    'Page 1 of 1',
    'Account holder',
    statement.holder,
    ...statement.address,
    'Account details',
    `Sort code ${statement.sortCode}`,
    `Account number ${statement.accountNumber}`,
    `IBAN ${statement.iban}`,
    `Statement period ${statement.period}`,
    'Date Description Paid out Paid in Balance',
  ]
  const rows = statement.rows.map((row) =>
    [row.date, row.description, row.paidOut ?? '', row.paidIn ?? '', row.balance]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const footer = `This is a specimen document for OCR benchmarking. Please quote sort code ${statement.sortCode} and account ${statement.accountNumber} in correspondence.`
  return [...header, ...rows, footer].join('\n')
}

export function statementKeywords(statement: BankStatement) {
  const fromRows = statement.rows
    .map((row) => row.description)
    .filter((value) => !/opening balance|closing balance/i.test(value))
  return [
    statement.bank,
    statement.holder,
    statement.sortCode,
    statement.accountNumber,
    statement.iban.replace(/\s+/g, ''),
    ...statement.address,
    ...fromRows,
    ...moneyValues(statement),
  ]
}

export function fixtureId(statementId: string, profileId: ScanProfileId) {
  return `${statementId}-${profileId}`
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function statementHtml(statement: BankStatement) {
  const rows = statement.rows
    .map((row) => {
      const openingOrClosing = /opening balance|closing balance/i.test(row.description)
      return `<tr class="${openingOrClosing ? 'emphasis' : ''}">
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.description)}</td>
        <td class="num">${escapeHtml(row.paidOut ?? '')}</td>
        <td class="num">${escapeHtml(row.paidIn ?? '')}</td>
        <td class="num">${escapeHtml(row.balance)}</td>
      </tr>`
    })
    .join('\n')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        background: #6d6d6d;
      }
      .page {
        width: 794px;
        min-height: 1123px;
        box-sizing: border-box;
        padding: 42px 48px 36px;
        background: #f4efe6;
        color: #1c1c1c;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12.5px;
        line-height: 1.35;
      }
      .brand {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 3px solid #1d3557;
        padding-bottom: 10px;
        margin-bottom: 16px;
      }
      .bank {
        font-family: "Times New Roman", Times, serif;
        font-size: 28px;
        letter-spacing: 0.02em;
        color: #1d3557;
        margin: 0;
      }
      .subtitle {
        margin: 4px 0 0;
        font-size: 13px;
        color: #333;
      }
      .issued {
        text-align: right;
        font-size: 11px;
        color: #444;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 1fr;
        gap: 18px;
        margin-bottom: 18px;
      }
      .label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #555;
        margin-bottom: 2px;
      }
      .mono {
        font-family: "Courier New", Courier, monospace;
        font-size: 13px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      th {
        text-align: left;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        border-bottom: 1px solid #1d3557;
        padding: 6px 4px;
      }
      th.num, td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      td {
        padding: 5px 4px;
        border-bottom: 1px solid #d9d1c4;
        font-size: 12px;
      }
      tr.emphasis td {
        font-weight: 700;
      }
      footer {
        margin-top: 28px;
        font-size: 10px;
        color: #666;
        border-top: 1px solid #cfc6b8;
        padding-top: 10px;
      }
    </style>
  </head>
  <body>
    <article class="page">
      <header class="brand">
        <div>
          <h1 class="bank">${escapeHtml(statement.bank)}</h1>
          <p class="subtitle">${escapeHtml(statement.subtitle)}</p>
        </div>
        <div class="issued">
          <div>Issued ${escapeHtml(statement.issued)}</div>
          <div>Page 1 of 1</div>
        </div>
      </header>
      <section class="grid">
        <div>
          <div class="label">Account holder</div>
          <div>${escapeHtml(statement.holder)}</div>
          ${statement.address.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
        </div>
        <div>
          <div class="label">Account details</div>
          <div>Sort code <span class="mono">${escapeHtml(statement.sortCode)}</span></div>
          <div>Account number <span class="mono">${escapeHtml(statement.accountNumber)}</span></div>
          <div>IBAN <span class="mono">${escapeHtml(statement.iban)}</span></div>
          <div>Statement period ${escapeHtml(statement.period)}</div>
        </div>
      </section>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th class="num">Paid out</th>
            <th class="num">Paid in</th>
            <th class="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <footer>
        This is a specimen document for OCR benchmarking. Please quote sort code
        ${escapeHtml(statement.sortCode)} and account ${escapeHtml(statement.accountNumber)} in correspondence.
      </footer>
    </article>
  </body>
</html>`
}
