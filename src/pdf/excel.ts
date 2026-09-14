import { strToU8, zipSync } from 'fflate'
import type { EditorDocument, PageOverlay } from '../domain/document'

interface TableCell {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
}

interface PositionedRow {
  cells: TableCell[]
  y: number
  bottom: number
}

interface PageRows {
  pageNumber: number
  rows: PositionedRow[]
}

export interface DetectedTable {
  rows: string[][]
  pageNumbers: number[]
}

interface PageTable extends DetectedTable {
  anchors: number[]
  top: number
  bottom: number
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function textCell(overlay: PageOverlay): TableCell | null {
  const text = overlay.text?.replace(/\s+/g, ' ').trim() ?? ''
  if (!overlay.extracted || overlay.type !== 'text' || !text) return null
  return {
    id: overlay.id,
    text,
    x: overlay.x,
    y: overlay.y,
    width: overlay.width,
    height: overlay.height,
  }
}

function groupRows(overlays: PageOverlay[]): PositionedRow[] {
  const cells = overlays
    .map(textCell)
    .filter((cell): cell is TableCell => cell !== null)
    .sort((left, right) => left.y - right.y || left.x - right.x)
  const rows: TableCell[][] = []
  for (const cell of cells) {
    const centre = cell.y + cell.height / 2
    const row = rows.find((candidate) => {
      const sample = candidate[0]
      const sampleCentre = sample.y + sample.height / 2
      return Math.abs(centre - sampleCentre) <= Math.max(sample.height, cell.height) * 0.45
    })
    if (row) row.push(cell)
    else rows.push([cell])
  }
  return rows
    .map((row) => {
      row.sort((left, right) => left.x - right.x)
      return {
        cells: row,
        y: Math.min(...row.map((cell) => cell.y)),
        bottom: Math.max(...row.map((cell) => cell.y + cell.height)),
      }
    })
    .sort((left, right) => left.y - right.y)
}

function cellDistance(left: TableCell, right: TableCell) {
  const leftCentre = left.x + left.width / 2
  const rightCentre = right.x + right.width / 2
  return Math.min(
    Math.abs(left.x - right.x),
    Math.abs(left.x + left.width - right.x - right.width),
    Math.abs(leftCentre - rightCentre),
  )
}

function rowAlignment(left: PositionedRow, right: PositionedRow) {
  const smaller = left.cells.length <= right.cells.length ? left.cells : right.cells
  const larger = smaller === left.cells ? right.cells : left.cells
  const matches = smaller.filter((cell) =>
    larger.some((candidate) => cellDistance(cell, candidate) <= 0.045),
  ).length
  return matches / Math.max(1, smaller.length)
}

function isTableBlock(rows: PositionedRow[]) {
  if (rows.length < 2) return false
  const widest = Math.max(...rows.map((row) => row.cells.length))
  return widest >= 3 || rows.length >= 3
}

function rowSignature(row: PositionedRow) {
  return normalizedRow(row.cells.map((cell) => cell.text)).join('\u001f')
}

function startsLikeDataValue(value: string) {
  return /^[£$€¥(+-]*\s*\d/.test(value.trim())
}

function looksLikeHeader(row: PositionedRow) {
  if (row.cells.length < 3) return false
  const values = row.cells.map((cell) => cell.text.trim())
  const dataValues = values.filter(startsLikeDataValue).length
  const labels = values.filter((value) => /[A-Za-z]/.test(value)).length
  return dataValues <= 1 && labels >= Math.ceil(values.length * 0.6)
}

function repeatedFurniture(pageRows: PageRows[]) {
  const appearances = new Map<string, Array<{ pageNumber: number; y: number }>>()
  for (const page of pageRows) {
    for (const row of page.rows) {
      for (const cell of row.cells) {
        const key = normalizedText(cell.text)
        if (!key) continue
        const list = appearances.get(key) ?? []
        list.push({ pageNumber: page.pageNumber, y: cell.y })
        appearances.set(key, list)
      }
    }
  }
  const ignored = new Set<string>()
  for (const [key, values] of appearances) {
    const pages = new Set(values.map(({ pageNumber }) => pageNumber))
    const meanY = values.reduce((total, value) => total + value.y, 0) / values.length
    if (pages.size >= 2 && meanY >= 0.82) ignored.add(key)
  }
  return ignored
}

function withoutFurniture(pageRows: PageRows[]) {
  const ignored = repeatedFurniture(pageRows)
  return pageRows.map((page) => ({
    ...page,
    rows: page.rows.flatMap((row) => {
      const cells = row.cells.filter((cell) => !ignored.has(normalizedText(cell.text)))
      if (cells.length === 0) return []
      return [{
        cells,
        y: Math.min(...cells.map((cell) => cell.y)),
        bottom: Math.max(...cells.map((cell) => cell.y + cell.height)),
      }]
    }),
  }))
}

function repeatedHeaderRows(pageRows: PageRows[]) {
  const signatures = new Map<string, Array<{ page: PageRows; row: PositionedRow }>>()
  for (const page of pageRows) {
    for (const row of page.rows) {
      if (!looksLikeHeader(row)) continue
      const signature = rowSignature(row)
      const list = signatures.get(signature) ?? []
      list.push({ page, row })
      signatures.set(signature, list)
    }
  }
  return [...signatures.values()].filter((occurrences) =>
    new Set(occurrences.map(({ page }) => page.pageNumber)).size >= 2,
  )
}

function mappedRow(cells: TableCell[], columns: TableCell[]) {
  const values = Array.from({ length: columns.length }, () => '')
  const indexes = new Set<number>()
  for (const cell of cells) {
    let target = 0
    let distance = Number.POSITIVE_INFINITY
    columns.forEach((column, index) => {
      const candidate = cellDistance(cell, column)
      if (candidate < distance) {
        distance = candidate
        target = index
      }
    })
    values[target] = values[target] ? `${values[target]} ${cell.text}` : cell.text
    indexes.add(target)
  }
  return { values, indexes }
}

function repeatedHeaderTables(pageRows: PageRows[], consumed: Set<string>): PageTable[] {
  return repeatedHeaderRows(pageRows).map((occurrences) => {
    const first = occurrences[0]
    const rows = [first.row.cells.map((cell) => cell.text)]
    const pageNumbers: number[] = []
    let bottom = first.row.bottom
    for (const { page, row: header } of occurrences) {
      pageNumbers.push(page.pageNumber)
      header.cells.forEach((cell) => consumed.add(cell.id))
      let current: string[] | null = null
      for (const row of page.rows) {
        if (row.y <= header.y || rowSignature(row) === rowSignature(header)) continue
        const mapped = mappedRow(row.cells, header.cells)
        if (mapped.indexes.size >= 2) {
          current = mapped.values
          rows.push(current)
          row.cells.forEach((cell) => consumed.add(cell.id))
          bottom = row.bottom
          continue
        }
        const onlyColumn = [...mapped.indexes][0]
        if (current && mapped.indexes.size === 1 && onlyColumn === 0) {
          current[0] = `${current[0]}\n${mapped.values[0]}`
          row.cells.forEach((cell) => consumed.add(cell.id))
          bottom = row.bottom
          continue
        }
        if (current) break
      }
    }
    return {
      rows,
      pageNumbers,
      anchors: first.row.cells.map((cell) => cell.x),
      top: first.row.y,
      bottom,
    }
  })
}

function mapRowsToColumns(rows: PositionedRow[]) {
  const reference = rows.reduce((best, row) =>
    row.cells.length > best.cells.length ? row : best,
  )
  const columns = reference.cells
  const mapped = rows.map((row) => {
    const values = Array.from({ length: columns.length }, () => '')
    for (const cell of row.cells) {
      let target = 0
      let distance = Number.POSITIVE_INFINITY
      columns.forEach((column, index) => {
        const candidate = cellDistance(cell, column)
        if (candidate < distance) {
          distance = candidate
          target = index
        }
      })
      if (distance > 0.12) continue
      values[target] = values[target] ? `${values[target]} ${cell.text}` : cell.text
    }
    return values
  }).filter((row) => row.some(Boolean))
  return {
    rows: mapped,
    anchors: columns.map((cell) => cell.x),
  }
}

function splitDistantRegions(row: PositionedRow): PositionedRow[] {
  if (row.cells.length < 3) return [row]
  const gaps = row.cells.slice(1).map((cell, index) =>
    cell.x - (row.cells[index].x + row.cells[index].width),
  )
  const largest = Math.max(...gaps)
  const splitAt = gaps.indexOf(largest) + 1
  if (largest < 0.14) return [row]
  const groups = [row.cells.slice(0, splitAt), row.cells.slice(splitAt)]
  const useful = groups.filter((cells) => cells.length >= 2)
  if (useful.length === 0) return [row]
  return useful.map((cells) => ({
    cells,
    y: Math.min(...cells.map((cell) => cell.y)),
    bottom: Math.max(...cells.map((cell) => cell.y + cell.height)),
  }))
}

function pageTables(page: PageRows, consumed: Set<string>): PageTable[] {
  const rows = page.rows.flatMap(splitDistantRegions).map((row) => ({
    ...row,
    cells: row.cells.filter((cell) => !consumed.has(cell.id)),
  })).filter((row) => row.cells.length > 0)
  const blocks: PositionedRow[][] = []
  let current: PositionedRow[] = []
  for (const row of rows) {
    if (row.cells.length < 2) {
      const aligned = current.some((candidate) => rowAlignment(candidate, row) >= 1)
      const previous = current.at(-1)
      const separated = previous && row.y - previous.bottom > 0.05
      if (current.length > 0 && aligned && !separated) {
        current.push(row)
        continue
      }
      if (isTableBlock(current)) blocks.push(current)
      current = []
      continue
    }
    const previous = current.at(-1)
    const separated = previous && row.y - previous.bottom > 0.05
    const unaligned = previous && rowAlignment(previous, row) < 0.34
    if (previous && (separated || unaligned)) {
      if (isTableBlock(current)) blocks.push(current)
      current = []
    }
    current.push(row)
  }
  if (isTableBlock(current)) blocks.push(current)
  return blocks.map((block) => ({
    ...mapRowsToColumns(block),
    pageNumbers: [page.pageNumber],
    top: block[0].y,
    bottom: block.at(-1)!.bottom,
  }))
}

function normalizedRow(row: string[] | undefined) {
  return (row ?? []).map(normalizedText)
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function rowsMatch(left: string[] | undefined, right: string[] | undefined) {
  const a = normalizedRow(left)
  const b = normalizedRow(right)
  return a.length === b.length && a.filter(Boolean).length >= 2 && a.every((value, index) => value === b[index])
}

function schemasMatch(left: PageTable, right: PageTable) {
  if (left.anchors.length !== right.anchors.length) return false
  const crossesPageEdge = left.bottom >= 0.45 && right.top <= 0.4
  if (!crossesPageEdge) return false
  if (rowsMatch(left.rows[0], right.rows[0])) return true
  const drift = left.anchors.reduce(
    (total, anchor, index) => total + Math.abs(anchor - right.anchors[index]),
    0,
  ) / left.anchors.length
  return drift <= 0.04
}

function columnDrift(left: PageTable, right: PageTable) {
  if (left.anchors.length !== right.anchors.length) return Number.POSITIVE_INFINITY
  return left.anchors.reduce(
    (total, anchor, index) => total + Math.abs(anchor - right.anchors[index]),
    0,
  ) / left.anchors.length
}

export function detectTables(document: EditorDocument): DetectedTable[] {
  const pageRows = withoutFurniture(document.pages.map((page, index) => ({
    pageNumber: index + 1,
    rows: groupRows(page.overlays),
  })))
  const consumed = new Set<string>()
  const detected = [
    ...repeatedHeaderTables(pageRows, consumed),
    ...pageRows.flatMap((page) => pageTables(page, consumed)),
  ].sort((left, right) =>
    left.pageNumbers[0] - right.pageNumbers[0] || left.top - right.top,
  )
  const merged: PageTable[] = []
  for (const table of detected) {
    const matchingHeader = merged.find((candidate) =>
      rowsMatch(candidate.rows[0], table.rows[0]),
    )
    if (matchingHeader) {
      matchingHeader.rows.push(...table.rows.slice(1))
      matchingHeader.pageNumbers.push(
        ...table.pageNumbers.filter(
          (pageNumber) => !matchingHeader.pageNumbers.includes(pageNumber),
        ),
      )
      matchingHeader.bottom = table.bottom
      continue
    }
    const previous = merged.at(-1)
    const samePageContinuation = previous
      && table.pageNumbers[0] === previous.pageNumbers.at(-1)
      && table.top - previous.bottom <= 0.08
      && columnDrift(previous, table) <= 0.06
    if (previous && samePageContinuation) {
      previous.rows.push(...table.rows)
      previous.bottom = table.bottom
      continue
    }
    const consecutive = previous && table.pageNumbers[0] === previous.pageNumbers.at(-1)! + 1
    if (previous && consecutive && schemasMatch(previous, table)) {
      previous.rows.push(...table.rows)
      previous.pageNumbers.push(...table.pageNumbers)
      previous.bottom = table.bottom
    } else {
      merged.push({
        anchors: [...table.anchors],
        rows: table.rows.map((row) => [...row]),
        pageNumbers: [...table.pageNumbers],
        top: table.top,
        bottom: table.bottom,
      })
    }
  }
  return merged.map(({ rows, pageNumbers }) => ({ rows, pageNumbers }))
}

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnName(index: number) {
  let value = index + 1
  let name = ''
  while (value > 0) {
    value -= 1
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26)
  }
  return name
}

function numericValue(value: string) {
  const trimmed = value.trim()
  const percent = trimmed.endsWith('%')
  const currency = trimmed.match(/[£$€¥]/)?.[0]
  const negative = /^\(.*\)$/.test(trimmed)
  let cleaned = trimmed
    .replace(/[£$€¥%]/g, '')
    .replace(/^\((.*)\)$/, '$1')
    .replace(/\s/g, '')
    .trim()
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (cleaned.includes(',')) {
    cleaned = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '')
  }
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  if (/^0\d+/.test(cleaned) && !/^0\./.test(cleaned)) return null
  const parsed = Number(cleaned)
  const number = (negative ? -Math.abs(parsed) : parsed) / (percent ? 100 : 1)
  if (!Number.isFinite(number)) return null
  const style = percent
    ? 3
    : currency === '£'
      ? 4
      : currency === '$'
        ? 5
        : currency === '€'
          ? 6
          : currency === '¥'
            ? 7
            : 2
  return { number, style }
}

function worksheetXml(rows: string[][]) {
  const columnCount = Math.max(1, ...rows.map((row) => row.length))
  const rowCount = Math.max(1, rows.length)
  const widths = Array.from({ length: columnCount }, (_, index) => {
    const longest = Math.max(8, ...rows.map((row) => row[index]?.length ?? 0))
    return Math.min(42, longest + 2)
  })
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`
      const numeric = rowIndex === 0 ? null : numericValue(value)
      if (numeric !== null) return `<c r="${ref}" s="${numeric.style}"><v>${numeric.number}</v></c>`
      const style = rowIndex === 0 ? ' s="1"' : ''
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const last = `${columnName(columnCount - 1)}${rowCount}`
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join('')
  const filter = rows.length > 1 ? `<autoFilter ref="A1:${columnName(columnCount - 1)}${rows.length}"/>` : ''
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${filter}</worksheet>`
}

function workbookFiles(tables: DetectedTable[]) {
  const files: Record<string, Uint8Array> = {}
  const sheets = tables.map((_, index) =>
    `<sheet name="Table ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join('')
  const relationships = tables.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('')
  const overrides = tables.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')
  files['[Content_Types].xml'] = strToU8(`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`)
  files['_rels/.rels'] = strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  files['xl/workbook.xml'] = strToU8(`${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`)
  files['xl/_rels/workbook.xml.rels'] = strToU8(`${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  files['xl/styles.xml'] = strToU8(`${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="0.00%"/><numFmt numFmtId="165" formatCode="£#,##0.00;[Red](£#,##0.00)"/><numFmt numFmtId="166" formatCode="$#,##0.00;[Red]($#,##0.00)"/><numFmt numFmtId="167" formatCode="€#,##0.00;[Red](€#,##0.00)"/><numFmt numFmtId="168" formatCode="¥#,##0.00;[Red](¥#,##0.00)"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF168E80"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  tables.forEach((table, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(table.rows))
  })
  return files
}

export function createExcelWorkbook(document: EditorDocument) {
  const tables = detectTables(document)
  if (tables.length === 0) {
    throw new Error('No tables were detected. Analyse the document again, then check that the table text is visible in the Text panel.')
  }
  return zipSync(workbookFiles(tables), { level: 6 })
}

export function excelFileName(pdfName: string) {
  const base = pdfName.replace(/\.pdf$/i, '').trim() || 'document'
  return `${base}-tables.xlsx`
}
