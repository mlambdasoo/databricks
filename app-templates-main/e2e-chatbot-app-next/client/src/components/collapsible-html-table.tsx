import { useState, useEffect, useRef, type ComponentProps } from 'react';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CollapsibleHtmlTableProps extends ComponentProps<'table'> {
  rowsPerPage?: number;
}

/**
 * Wraps HTML tables with pagination
 */
export function CollapsibleHtmlTable({
  children,
  rowsPerPage = 15,
  ...props
}: CollapsibleHtmlTableProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [needsPagination, setNeedsPagination] = useState(false);

  useEffect(() => {
    if (!tableRef.current) return;

    const tbody = tableRef.current.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const rowCount = rows.length;
    setTotalRows(rowCount);
    setTotalPages(Math.ceil(rowCount / rowsPerPage));
    setNeedsPagination(rowCount > rowsPerPage);

    // Show/hide rows based on current page
    if (rowCount > rowsPerPage) {
      const startRow = currentPage * rowsPerPage;
      const endRow = startRow + rowsPerPage;

      rows.forEach((row, index) => {
        if (index >= startRow && index < endRow) {
          (row as HTMLElement).style.display = '';
        } else {
          (row as HTMLElement).style.display = 'none';
        }
      });
    } else {
      // Show all rows if no pagination needed
      rows.forEach((row) => {
        (row as HTMLElement).style.display = '';
      });
    }
  }, [children, currentPage, rowsPerPage]);

  const startRow = currentPage * rowsPerPage + 1;
  const endRow = Math.min((currentPage + 1) * rowsPerPage, totalRows);

  return (
    <div className="my-4 space-y-2">
      {needsPagination && (
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-muted-foreground text-xs">
            Showing rows {startRow}-{endRow} of {totalRows.toLocaleString()}
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
      <div className="overflow-x-auto rounded-md border">
        <table
          ref={tableRef}
          {...props}
          className="w-full border-collapse text-left text-sm [&_td]:max-w-[300px] [&_td]:truncate [&_td]:p-2 [&_th]:max-w-[300px] [&_th]:truncate [&_th]:p-2 [&_td]:hover:whitespace-normal [&_td]:hover:overflow-visible"
        >
          {children}
        </table>
      </div>
    </div>
  );
}
