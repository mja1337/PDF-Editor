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
  cellIds: string[]
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

function isTableBlock(rows: PositionedRow[]) {
  if (rows.length < 2) return false
  const widest = Math.max(...rows.map((row) => row.cells.length))
  return widest >= 3 || rows.length >= 3
}

/**
 * How completely the rows fill their columns. A grid fills nearly every cell;
 * a panel of scattered labels and checkboxes leaves most of them empty, and is
 * page furniture rather than a table.
 */
const MIN_FILL = 0.62

function fillRatio(rows: string[][], columns: number) {
  if (rows.length === 0 || columns === 0) return 0
  const filled = rows.reduce(
    (total, row) => total + row.filter((value) => value !== '').length,
    0,
  )
  return filled / (rows.length * columns)
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
      cellIds: [...consumed],
    }
  })
}

/** How close a cell's left edge must sit to a column anchor to belong to it. */
const ANCHOR_TOLERANCE = 0.015

/** A row this far below the previous one starts a new block regardless of shape. */
const BLOCK_GAP = 0.06

/**
 * Column positions for a block, clustered from the left edge of every cell in
 * it. Using every row rather than the widest one means a table keeps its
 * columns when some rows leave trailing cells empty.
 */
function clusterAnchors(rows: PositionedRow[]) {
  const edges = rows.flatMap((row) => row.cells.map((cell) => cell.x)).sort((a, b) => a - b)
  const groups: number[][] = []
  for (const edge of edges) {
    const last = groups.at(-1)
    const mean = last ? last.reduce((total, value) => total + value, 0) / last.length : 0
    if (last && edge - mean <= ANCHOR_TOLERANCE) last.push(edge)
    else groups.push([edge])
  }
  return groups.map((group) => ({
    x: group.reduce((total, value) => total + value, 0) / group.length,
    count: group.length,
  }))
}

/**
 * Every cluster is offered as a column, including one a single cell wide: a
 * heading with no data under it still tells us where its column starts, which
 * is what lets a merged heading be cut apart. Columns that end up empty are
 * dropped after the rows are placed.
 */
function anchorPositions(rows: PositionedRow[]) {
  return clusterAnchors(rows).map((anchor) => anchor.x)
}

function nearestAnchor(x: number, anchors: number[]) {
  let index = 0
  let best = Number.POSITIVE_INFINITY
  anchors.forEach((anchor, candidate) => {
    const distance = Math.abs(anchor - x)
    if (distance < best) {
      best = distance
      index = candidate
    }
  })
  return index
}

function alignedCount(row: PositionedRow, anchors: number[]) {
  return row.cells.filter((cell) =>
    anchors.some((anchor) => Math.abs(anchor - cell.x) <= ANCHOR_TOLERANCE),
  ).length
}

/**
 * A run that spans more than one column carries more than one heading, which is
 * how "TAB" and "SHOW IN LIST" arrive as a single cell. Cut it where the next
 * column starts, snapping to the nearest word boundary.
 */
function splitAcrossAnchors(cell: TableCell, anchors: number[]) {
  const covered = anchors
    .map((anchor, index) => ({ anchor, index }))
    .filter(({ anchor }) => anchor > cell.x + ANCHOR_TOLERANCE && anchor < cell.x + cell.width)
  if (covered.length === 0 || cell.width <= 0) return null
  const pieces: Array<{ index: number; text: string }> = []
  let cursor = 0
  let start = nearestAnchor(cell.x, anchors)
  for (const { anchor, index } of covered) {
    const fraction = (anchor - cell.x) / cell.width
    const target = Math.round(fraction * cell.text.length)
    const boundary = wordBoundaryNear(cell.text, target)
    if (boundary <= cursor) continue
    pieces.push({ index: start, text: cell.text.slice(cursor, boundary).trim() })
    cursor = boundary
    start = index
  }
  pieces.push({ index: start, text: cell.text.slice(cursor).trim() })
  return pieces.filter((piece) => piece.text.length > 0)
}

function wordBoundaryNear(text: string, target: number) {
  if (target <= 0 || target >= text.length) return Math.max(0, Math.min(text.length, target))
  for (let offset = 0; offset <= text.length; offset += 1) {
    if (text[target - offset] === ' ') return target - offset
    if (text[target + offset] === ' ') return target + offset
  }
  return target
}

/** Places every cell of a row into its column. No cell is ever dropped. */
function rowValues(row: PositionedRow, anchors: number[]) {
  const values = Array.from({ length: anchors.length }, () => '')
  const add = (index: number, text: string) => {
    if (!text) return
    values[index] = values[index] ? `${values[index]} ${text}` : text
  }
  for (const cell of row.cells) {
    const pieces = splitAcrossAnchors(cell, anchors)
    if (pieces) {
      for (const piece of pieces) add(piece.index, piece.text)
      continue
    }
    add(nearestAnchor(cell.x, anchors), cell.text)
  }
  return values
}

/**
 * Groups rows into blocks by column agreement rather than by cell count, so a
 * row that fills only two of six columns stays with its table.
 */
function blocksForPage(rows: PositionedRow[]): PositionedRow[][] {
  const blocks: PositionedRow[][] = []
  let current: PositionedRow[] = []
  for (const row of rows) {
    const previous = current.at(-1)
    if (previous && row.y - previous.bottom > BLOCK_GAP) {
      if (current.length > 0) blocks.push(current)
      current = [row]
      continue
    }
    if (current.length < 2) {
      current.push(row)
      continue
    }
    const anchors = anchorPositions(current)
    const aligned = alignedCount(row, anchors)
    const joins = row.cells.length >= 2 ? aligned >= 2 : aligned >= 1
    if (joins) {
      current.push(row)
      continue
    }
    blocks.push(current)
    current = [row]
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

function pageTables(page: PageRows, consumed: Set<string>): PageTable[] {
  const rows = page.rows
    .map((row) => ({
      ...row,
      cells: row.cells.filter((cell) => !consumed.has(cell.id)),
    }))
    .filter((row) => row.cells.length > 0)
  return blocksForPage(rows)
    .filter(isTableBlock)
    .map((block) => {
      const anchors = anchorPositions(block)
      return {
        rows: block.map((row) => rowValues(row, anchors)).filter((row) => row.some(Boolean)),
        anchors,
        pageNumbers: [page.pageNumber],
        top: block[0].y,
        bottom: block.at(-1)!.bottom,
        cellIds: block.flatMap((row) => row.cells.map((cell) => cell.id)),
      }
    })
    .filter((table) => table.rows.length > 0)
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
  const crossesPageEdge = left.bottom >= 0.45 && right.top <= 0.4
  if (!crossesPageEdge) return false
  if (rowsMatch(left.rows[0], right.rows[0])) return true
  return anchorMapping(left.anchors, right.anchors) !== null
    || anchorMapping(right.anchors, left.anchors) !== null
}

/**
 * Lines up one table's columns with another's. A continuation page often omits
 * a column the first page had, so matching on column count alone loses it.
 */
function anchorMapping(base: number[], other: number[]) {
  const mapping: number[] = []
  for (const anchor of other) {
    const index = nearestAnchor(anchor, base)
    if (Math.abs(base[index] - anchor) > ANCHOR_TOLERANCE * 2) return null
    if (mapping.includes(index)) return null
    mapping.push(index)
  }
  return mapping
}

function remapRows(rows: string[][], mapping: number[], width: number) {
  return rows.map((row) => {
    const values = Array.from({ length: width }, () => '')
    row.forEach((value, index) => {
      const target = mapping[index]
      if (!value || target === undefined) return
      values[target] = values[target] ? `${values[target]} ${value}` : value
    })
    return values
  })
}

/** Appends one table to another when their columns line up, either way round. */
function joinTables(base: PageTable, table: PageTable) {
  const forward = anchorMapping(base.anchors, table.anchors)
  if (forward) {
    base.rows.push(...remapRows(table.rows, forward, base.anchors.length))
    base.cellIds.push(...table.cellIds)
    return true
  }
  const widened = anchorMapping(table.anchors, base.anchors)
  if (!widened) return false
  base.rows = [
    ...remapRows(base.rows, widened, table.anchors.length),
    ...table.rows.map((row) => [...row]),
  ]
  base.anchors = [...table.anchors]
  base.cellIds.push(...table.cellIds)
  return true
}

function prunedTable(table: PageTable): DetectedTable {
  const used = table.anchors
    .map((_, index) => index)
    .filter((index) => table.rows.some((row) => row[index]))
  return {
    rows: table.rows.map((row) => used.map((index) => row[index])),
    pageNumbers: table.pageNumbers,
  }
}

function columnDrift(left: PageTable, right: PageTable) {
  if (left.anchors.length !== right.anchors.length) return Number.POSITIVE_INFINITY
  return left.anchors.reduce(
    (total, anchor, index) => total + Math.abs(anchor - right.anchors[index]),
    0,
  ) / left.anchors.length
}

function detectedTables(document: EditorDocument): PageTable[] {
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
      matchingHeader.cellIds.push(...table.cellIds)
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
      previous.cellIds.push(...table.cellIds)
      previous.bottom = table.bottom
      continue
    }
    const consecutive = previous && table.pageNumbers[0] === previous.pageNumbers.at(-1)! + 1
    if (previous && consecutive && schemasMatch(previous, table) && joinTables(previous, table)) {
      previous.pageNumbers.push(...table.pageNumbers)
      previous.bottom = table.bottom
    } else {
      merged.push({
        anchors: [...table.anchors],
        rows: table.rows.map((row) => [...row]),
        pageNumbers: [...table.pageNumbers],
        top: table.top,
        bottom: table.bottom,
        cellIds: [...table.cellIds],
      })
    }
  }
  // One column is a list, and a sparse grid is a panel of labels. Applied after
  // merging so it judges the finished table, whichever path produced it.
  return merged
    .map((table) => ({ ...table, ...prunedTable(table) }))
    .filter((table) => (table.rows[0]?.length ?? 0) >= 2)
    .filter((table) => fillRatio(table.rows, table.rows[0].length) >= MIN_FILL)
}

export function detectTables(document: EditorDocument): DetectedTable[] {
  return detectedTables(document).map(({ rows, pageNumbers }) => ({ rows, pageNumbers }))
}

export interface ExtractedSheets {
  tables: DetectedTable[]
  info: string[][]
}

/**
 * Text that no table claimed -- a record's header panel, standalone notes -- in
 * reading order. It is the part of the page a table export used to throw away.
 */
function leftoverRows(document: EditorDocument, used: Set<string>) {
  const pages = withoutFurniture(document.pages.map((page, index) => ({
    pageNumber: index + 1,
    rows: groupRows(page.overlays),
  })))
  const rows: string[][] = []
  for (const page of pages) {
    const kept = page.rows
      .map((row) => row.cells.filter((cell) => !used.has(cell.id)))
      .filter((cells) => cells.length > 0)
      .map((cells) => cells.map((cell) => cell.text))
    if (kept.length === 0) continue
    if (pages.length > 1) rows.push([`Page ${page.pageNumber}`])
    rows.push(...kept)
  }
  return rows
}

export function extractSheets(document: EditorDocument): ExtractedSheets {
  const detected = detectedTables(document)
  const used = new Set(detected.flatMap((table) => table.cellIds))
  return {
    tables: detected.map(({ rows, pageNumbers }) => ({ rows, pageNumbers })),
    info: leftoverRows(document, used),
  }
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

interface NamedSheet {
  name: string
  rows: string[][]
}

function workbookFiles(tables: NamedSheet[]) {
  const files: Record<string, Uint8Array> = {}
  const sheets = tables.map((sheet, index) =>
    `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
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
  tables.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows))
  })
  return files
}

export function createExcelWorkbook(document: EditorDocument) {
  const { tables, info } = extractSheets(document)
  if (tables.length === 0 && info.length === 0) {
    throw new Error('No tables were detected. Analyse the document again, then check that the table text is visible in the Text panel.')
  }
  const sheets: NamedSheet[] = tables.map((table, index) => ({
    name: `Table ${index + 1}`,
    rows: table.rows,
  }))
  // Everything the tables did not claim, kept rather than discarded.
  if (info.length > 0) sheets.push({ name: 'Document info', rows: info })
  return zipSync(workbookFiles(sheets), { level: 6 })
}

export function excelFileName(pdfName: string) {
  const base = pdfName.replace(/\.pdf$/i, '').trim() || 'document'
  return `${base}-tables.xlsx`
}
