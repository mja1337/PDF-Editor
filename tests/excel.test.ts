import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createEditorDocument } from '../src/domain/document'
import type { PageOverlay } from '../src/domain/document'
import { createExcelWorkbook, detectTables, excelFileName, extractSheets } from '../src/pdf/excel'

function cell(text: string, x: number, y: number): PageOverlay {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x,
    y,
    width: 0.12,
    height: 0.025,
    color: '#000000',
    opacity: 1,
    strokeWidth: 1,
    text,
    extracted: true,
  }
}

function row(y: number, values: string[]) {
  return values.map((value, index) => cell(value, 0.1 + index * 0.2, y))
}

/** A cell placed and sized exactly, for layouts where geometry is the point. */
function at(text: string, x: number, y: number, width: number): PageOverlay {
  return { ...cell(text, x, y), width, height: 0.012 }
}

/**
 * The shape of a NetSuite record export: a wide gap between the first two
 * columns, two headings close enough to have been merged into one run, a
 * continuation page that omits an empty column, and a sparse settings panel.
 */
function recordPages() {
  const columns = [0.069, 0.323, 0.593, 0.698]
  const fieldRow = (y: number, values: string[], showInList: string) => [
    ...values.map((value, index) => at(value, columns[index], y, 0.1)),
    at(showInList, 0.909, y, 0.016),
  ]
  // Three ragged bands of labels and checkboxes: most rows leave most of the
  // panel empty, which is what makes it a panel and not a grid.
  const settings = [
    at('NAME *', 0.015, 0.088, 0.03),
    at('ACCESS TYPE', 0.341, 0.087, 0.063),
    at('ALLOW QUICK ADD', 0.766, 0.087, 0.084),
    at('Vehicle', 0.018, 0.098, 0.031),
    at('Use Permission List', 0.344, 0.097, 0.086),
    at('ID', 0.015, 0.113, 0.009),
    at('customrecord_acc_vehicle', 0.015, 0.121, 0.116),
    at('INCLUDE IN SEARCH MENU', 0.766, 0.122, 0.12),
    at('ORIGINATING CUSTOM SEGMENT', 0.015, 0.132, 0.147),
    at('ALLOW ATTACHMENTS', 0.358, 0.14, 0.1),
    at('OWNER', 0.015, 0.152, 0.035),
    at('SHOW NOTES', 0.358, 0.152, 0.062),
    at('ENABLE NAME TRANSLATION', 0.766, 0.157, 0.129),
    at('Mark Anderson', 0.018, 0.163, 0.066),
    at('HIERARCHY', 0.766, 0.168, 0.053),
    at('DESCRIPTION', 0.015, 0.177, 0.062),
  ]
  const header = [
    at('DESCRIPTION', 0.067, 0.346, 0.056),
    at('ID', 0.321, 0.346, 0.008),
    at('TYPE', 0.592, 0.346, 0.022),
    at('LIST/RECORD', 0.697, 0.346, 0.056),
    // "TAB" and "SHOW IN LIST" arrive merged, as adjacent runs do.
    at('TAB SHOW IN LIST', 0.881, 0.346, 0.082),
  ]
  const first = [
    ...settings,
    ...header,
    ...fieldRow(0.358, ['Driver', 'custrecord_acc_veh_driver', 'List/Record', 'Employee'], 'Yes'),
    ...fieldRow(0.374, ['Registration', 'custrecord_acc_veh_reg', 'Free-Form Text'], 'Yes'),
    ...fieldRow(0.389, ['Vehicle Status', 'custrecord_acc_veh_status', 'List/Record', 'Status List'], 'No'),
    // The table runs to the foot of the page, which is why it continues at all.
    ...fieldRow(0.405, ['Fuel Card', 'custrecord_acc_veh_fuel', 'List/Record', 'Fuel Card List'], 'No'),
    ...fieldRow(0.42, ['Initial Payment', 'custrecord_acc_veh_initial', 'Currency'], 'No'),
    ...fieldRow(0.44, ['Employee Contribution', 'custrecord_acc_veh_contrib', 'Currency'], 'No'),
    ...fieldRow(0.46, ['Lease Start', 'custrecord_acc_veh_lease', 'Date'], 'Yes'),
  ]
  const second = [
    ...fieldRow(0.007, ['Monthly Cost', 'custrecord_acc_veh_cost', 'Currency'], 'No'),
    ...fieldRow(0.023, ['Date Added', 'custrecord_acc_veh_added', 'Date'], 'No'),
    ...fieldRow(0.038, ['Comments', 'custrecord_acc_veh_comments', 'Long Text'], 'No'),
  ]
  const document = createEditorDocument('record.pdf', 1, 2)
  document.pages[0].overlays = first
  document.pages[1].overlays = second
  return document
}

describe('Excel table export', () => {
  it('detects separate tables and keeps aligned rows together', () => {
    const document = createEditorDocument('invoice.pdf', 1, 1)
    document.pages[0].overlays = [
      ...row(0.1, ['Item', 'Qty', 'Amount']),
      ...row(0.14, ['Paper', '2', '12.50']),
      ...row(0.18, ['Ink', '1', '8.00']),
      cell('Notes', 0.1, 0.3),
      ...row(0.4, ['Tax', 'Rate']),
      ...row(0.44, ['VAT', '20%']),
      ...row(0.48, ['Total', '4.10']),
    ]

    expect(detectTables(document).map((table) => table.rows)).toEqual([
      [
        ['Item', 'Qty', 'Amount'],
        ['Paper', '2', '12.50'],
        ['Ink', '1', '8.00'],
      ],
      [
        ['Tax', 'Rate'],
        ['VAT', '20%'],
        ['Total', '4.10'],
      ],
    ])
  })

  it('joins a continued table and removes repeated page headers', () => {
    const document = createEditorDocument('statement.pdf', 1, 2)
    document.pages[0].overlays = [
      ...row(0.75, ['Date', 'Description', 'Amount']),
      ...row(0.79, ['1 Sep', 'Opening balance', '100.00']),
      ...row(0.83, ['2 Sep', 'Invoice 10', '25.00']),
    ]
    document.pages[1].overlays = [
      ...row(0.08, ['Date', 'Description', 'Amount']),
      ...row(0.12, ['3 Sep', 'Credit memo', '(5.00)']),
    ]

    expect(detectTables(document)).toEqual([
      {
        pageNumbers: [1, 2],
        rows: [
          ['Date', 'Description', 'Amount'],
          ['1 Sep', 'Opening balance', '100.00'],
          ['2 Sep', 'Invoice 10', '25.00'],
          ['3 Sep', 'Credit memo', '(5.00)'],
        ],
      },
    ])
  })

  it('attaches wrapped text to its record and ignores repeated page footers', () => {
    const document = createEditorDocument('wrapped.pdf', 1, 2)
    for (const [index, page] of document.pages.entries()) {
      page.overlays = [
        ...row(0.1, ['Description', 'Qty', 'Unit price', 'VAT', 'Amount']),
        ...row(0.14, ['Service', '1 Hr', '£147,00', '20%', '£147,00']),
        cell(`2026-08-0${index + 1}, Person`, 0.1, 0.165),
        cell('Work notes', 0.1, 0.19),
        ...row(0.86, ['Example Services Ltd', 'Company number', '12345678']),
        ...row(0.9, ['Exampletown', 'Bank', 'Example Bank']),
      ]
    }

    expect(detectTables(document)).toEqual([
      {
        pageNumbers: [1, 2],
        rows: [
          ['Description', 'Qty', 'Unit price', 'VAT', 'Amount'],
          ['Service\n2026-08-01, Person\nWork notes', '1 Hr', '£147,00', '20%', '£147,00'],
          ['Service\n2026-08-02, Person\nWork notes', '1 Hr', '£147,00', '20%', '£147,00'],
        ],
      },
    ])
  })

  it('consolidates tables with identical headers across the document', () => {
    const document = createEditorDocument('invoices.pdf', 1, 3)
    document.pages[0].overlays = [
      ...row(0.1, ['Item', 'Qty', 'Amount']),
      ...row(0.14, ['Paper', '2', '12.50']),
    ]
    document.pages[1].overlays = [
      ...row(0.1, ['Tax', 'Rate', 'Value']),
      ...row(0.14, ['VAT', '20%', '2.50']),
    ]
    document.pages[2].overlays = [
      ...row(0.1, ['Item', 'Qty', 'Amount']),
      ...row(0.14, ['Ink', '1', '8.00']),
    ]

    expect(detectTables(document)).toEqual([
      {
        pageNumbers: [1, 3],
        rows: [
          ['Item', 'Qty', 'Amount'],
          ['Paper', '2', '12.50'],
          ['Ink', '1', '8.00'],
        ],
      },
      {
        pageNumbers: [2],
        rows: [
          ['Tax', 'Rate', 'Value'],
          ['VAT', '20%', '2.50'],
        ],
      },
    ])
  })

  it('keeps a record export as one table with its headings split apart', () => {
    const [table, ...rest] = detectTables(recordPages())
    expect(rest).toEqual([])
    expect(table.pageNumbers).toEqual([1, 2])
    // The heading that arrived merged is cut back into its two columns.
    expect(table.rows[0]).toEqual([
      'DESCRIPTION', 'ID', 'TYPE', 'LIST/RECORD', 'TAB', 'SHOW IN LIST',
    ])
    // The wide gap before the second column no longer costs the label column.
    expect(table.rows[1][0]).toBe('Driver')
    expect(table.rows.map((values) => values[0])).toEqual([
      'DESCRIPTION', 'Driver', 'Registration', 'Vehicle Status', 'Fuel Card',
      'Initial Payment', 'Employee Contribution', 'Lease Start',
      'Monthly Cost', 'Date Added', 'Comments',
    ])
    // The continuation page omits the empty TAB column and still lines up.
    expect(table.rows.at(-1)).toEqual([
      'Comments', 'custrecord_acc_veh_comments', 'Long Text', '', '', 'No',
    ])
  })

  it('puts the settings panel on its own sheet instead of inventing a table', () => {
    const { tables, info } = extractSheets(recordPages())
    expect(tables).toHaveLength(1)
    const flattened = info.map((values) => values.join(' | '))
    expect(flattened).toContain('NAME * | ACCESS TYPE | ALLOW QUICK ADD')
    expect(flattened).toContain('Vehicle | Use Permission List')
    expect(flattened).toContain('OWNER | SHOW NOTES | ENABLE NAME TRANSLATION')
    // None of the field rows leaked into it.
    expect(flattened.join(' ')).not.toContain('custrecord')

    const files = unzipSync(createExcelWorkbook(recordPages()))
    const workbook = strFromU8(files['xl/workbook.xml'])
    expect(workbook).toContain('name="Table 1"')
    expect(workbook).toContain('name="Document info"')
  })

  it('creates a multi-sheet workbook with typed numeric cells', () => {
    const document = createEditorDocument('credit memo.pdf', 1, 1)
    document.pages[0].overlays = [
      ...row(0.1, ['Item', 'Qty', 'Amount']),
      ...row(0.14, ['Paper', '2', '£1 197,00']),
      ...row(0.18, ['Credit', '1', '(5.00)']),
      cell('Break', 0.1, 0.3),
      ...row(0.4, ['Tax', 'Rate', 'Value']),
      ...row(0.44, ['VAT', '20%', '1.50']),
    ]
    const files = unzipSync(createExcelWorkbook(document))
    const workbook = strFromU8(files['xl/workbook.xml'])
    const firstSheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(workbook).toContain('name="Table 1"')
    expect(workbook).toContain('name="Table 2"')
    expect(firstSheet).toContain('<c r="B2" s="2"><v>2</v></c>')
    expect(firstSheet).toContain('<c r="C2" s="4"><v>1197</v></c>')
    expect(firstSheet).toContain('<c r="C3" s="2"><v>-5</v></c>')
    expect(excelFileName('credit memo.pdf')).toBe('credit memo-tables.xlsx')
  })
})
