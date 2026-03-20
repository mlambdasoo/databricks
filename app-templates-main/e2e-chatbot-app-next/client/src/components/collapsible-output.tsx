import { useState } from 'react';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TabularData {
  columns: string[];
  rows: any[][];
}

/**
 * Checks if output matches {"columns": [...], "rows": [...]} format
 */
export function isTabularData(output: unknown): output is TabularData {
  if (typeof output !== 'object' || output === null) return false;
  const data = output as Record<string, unknown>;
  return (
    Array.isArray(data.columns) &&
    Array.isArray(data.rows) &&
    data.columns.every((col) => typeof col === 'string')
  );
}

/**
 * Checks if string contains a markdown table
 * Looks for pipe-delimited rows with separator line (|---|)
 */
export function isMarkdownTable(text: string): boolean {
  if (typeof text !== 'string') return false;
  const lines = text.trim().split('\n');
  if (lines.length < 2) return false;

  // Check if any line looks like a markdown table separator (|---|---|)
  return lines.some((line) => /^\|[\s:-]+\|/.test(line.trim()));
}

/**
 * Parse markdown table into TabularData format
 * Handles tables like:
 * | col1 | col2 |
 * |------|------|
 * | val1 | val2 |
 *
 * Also handles pandas-style tables with index column:
 * | | col1 | col2 |
 * |----:|:-----|:-----|
 * | 0 | val1 | val2 |
 */
export function parseMarkdownTable(text: string): TabularData | null {
  if (!isMarkdownTable(text)) return null;

  const lines = text.trim().split('\n').filter((line) => line.trim());
  if (lines.length < 2) return null;

  // Find the separator line (|---|---|)
  const separatorIndex = lines.findIndex((line) => /^\|[\s:-]+\|/.test(line.trim()));
  if (separatorIndex < 1) return null;

  // Header is the line before separator
  const headerLine = lines[separatorIndex - 1];
  // Split and keep track of cells (including empty ones for index columns)
  const rawHeaderCells = headerLine
    .split('|')
    .slice(1, -1) // Remove empty first/last from split on |...|
    .map((cell) => cell.trim());

  // Build columns array, replacing empty first cell with '#' for index (pandas style)
  const columns = rawHeaderCells.map((cell, idx) => {
    if (cell === '' && idx === 0) return '#'; // Index column
    if (cell === '') return `col${idx}`; // Other empty columns get generic name
    return cell;
  });

  // Rows are all lines after separator
  const rows: any[][] = [];
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1) // Remove empty first/last from split on |...|
      .map((cell) => cell.trim());

    // Parse numeric values
    const parsedCells = cells.map((cell) => {
      if (cell === '' || cell === '-') return null;
      const num = Number(cell);
      return Number.isNaN(num) ? cell : num;
    });

    // Only add row if it has the right number of columns
    if (parsedCells.length === columns.length) {
      rows.push(parsedCells);
    } else if (parsedCells.length > 0) {
      // Pad or trim to match column count
      const adjusted = columns.map((_, idx) => parsedCells[idx] ?? null);
      rows.push(adjusted);
    }
  }

  if (columns.length === 0 || rows.length === 0) return null;

  return { columns, rows };
}

interface CollapsibleTableProps {
  data: TabularData;
  rowsPerPage?: number;
}

/**
 * Renders tabular data with pagination
 */
export function CollapsibleTable({
  data,
  rowsPerPage = 15,
}: CollapsibleTableProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const { columns, rows } = data;
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage);
  const needsPagination = totalRows > rowsPerPage;

  const startRow = currentPage * rowsPerPage;
  const endRow = Math.min(startRow + rowsPerPage, totalRows);
  const displayRows = rows.slice(startRow, endRow);

  return (
    <div className="space-y-2">
      {needsPagination && (
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-muted-foreground text-xs">
            Showing rows {startRow + 1}-{endRow} of {totalRows.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-muted-foreground text-xs">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
              }
              disabled={currentPage >= totalPages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((col, i) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are stable and order-dependent
                  key={i}
                  className="px-3 py-2 font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are stable within current page
              <tr key={rowIndex} className="border-b last:border-b-0">
                {row.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are stable within row
                  <td key={cellIndex} className="px-3 py-2">
                    {cell === null || cell === undefined ? '-' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CollapsibleJsonProps {
  json: string;
  linesPerPage?: number;
}

/**
 * Renders large JSON payloads with pagination
 */
export function CollapsibleJson({
  json,
  linesPerPage = 10,
}: CollapsibleJsonProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const lines = json.split('\n');
  const totalLines = lines.length;
  const totalPages = Math.ceil(totalLines / linesPerPage);
  const needsPagination = totalLines > linesPerPage;

  const startLine = currentPage * linesPerPage;
  const endLine = Math.min(startLine + linesPerPage, totalLines);
  const displayLines = lines.slice(startLine, endLine);

  return (
    <div className="space-y-2">
      {needsPagination && (
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-muted-foreground text-xs">
            Showing lines {startLine + 1}-{endLine} of{' '}
            {totalLines.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-muted-foreground text-xs">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
              }
              disabled={currentPage >= totalPages - 1}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <pre className="whitespace-pre-wrap font-mono text-xs">
          {displayLines.join('\n')}
        </pre>
      </div>
    </div>
  );
}
