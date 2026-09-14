import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createEditorDocument } from '../src/domain/document'
import type { PageOverlay } from '../src/domain/document'
import { createExcelWorkbook, detectTables, excelFileName } from '../src/pdf/excel'

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
