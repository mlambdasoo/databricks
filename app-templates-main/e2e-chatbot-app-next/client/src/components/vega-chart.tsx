import { useEffect, useRef, useState, useMemo } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';
import { cn } from '@/lib/utils';

interface VegaChartProps {
  spec: VisualizationSpec;
  className?: string;
}

export function VegaChart({ spec, className }: VegaChartProps) {
  // Ref for the outer container (React-managed, but we only use it as a mount point)
  const containerRef = useRef<HTMLDivElement>(null);
  // Store vega view for cleanup
  const viewRef = useRef<any>(null);
  // Store the imperatively created vega container
  const vegaDivRef = useRef<HTMLDivElement | null>(null);
  // Track the spec we've already rendered to avoid teardown/rebuild on same content
  const renderedSpecRef = useRef<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Stable ID for this chart instance
  const chartId = useMemo(() => {
    return `vega-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Stabilize the spec: use JSON string as the effect dependency
  // so new object references with identical content don't trigger re-renders
  const specString = useMemo(() => {
    try {
      return JSON.stringify(spec);
    } catch {
      return null;
    }
  }, [spec]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !specString) {
      return;
    }

    // Skip if we've already rendered this exact spec
    if (renderedSpecRef.current === specString && viewRef.current) {
      return;
    }

    let isMounted = true;

    const renderChart = async () => {
      try {
        setError(null);
        setIsLoading(true);

        // Clean up previous vega instance if exists
        if (viewRef.current?.finalize) {
          try {
            viewRef.current.finalize();
          } catch (_e) {
            // Ignore
          }
          viewRef.current = null;
        }

        // Remove previous vega container if exists
        if (vegaDivRef.current?.parentNode) {
          vegaDivRef.current.parentNode.removeChild(vegaDivRef.current);
          vegaDivRef.current = null;
        }

        // Create vega container IMPERATIVELY - React has no knowledge of this element
        const vegaDiv = document.createElement('div');
        vegaDiv.className = 'vega-render-target';
        vegaDiv.style.width = '100%';
        container.appendChild(vegaDiv);
        vegaDivRef.current = vegaDiv;

        // Wait for DOM to be ready
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });

        if (!isMounted) {
          return;
        }

        const parsedSpec = JSON.parse(specString);

        // Vega-embed renders into the imperatively created container
        const result = await embed(vegaDiv, parsedSpec, {
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          renderer: 'svg',
          logLevel: 2,
        });

        if (isMounted) {
          viewRef.current = result;
          renderedSpecRef.current = specString;
          setIsLoading(false);
        } else {
          // Component unmounted during render, clean up
          if (result?.finalize) {
            result.finalize();
          }
        }
      } catch (err) {
        console.error('[VegaChart] Render error:', err);
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : 'Failed to render chart',
          );
          setIsLoading(false);
        }
      }
    };

    renderChart();

    // Cleanup function
    return () => {
      isMounted = false;

      // Finalize vega view first (this cleans up vega's internal state)
      if (viewRef.current?.finalize) {
        try {
          viewRef.current.finalize();
        } catch (_e) {
          // Ignore cleanup errors
        }
        viewRef.current = null;
      }

      // Remove the imperatively created vega container
      // This is safe because React never knew about this element
      if (vegaDivRef.current?.parentNode) {
        try {
          vegaDivRef.current.parentNode.removeChild(vegaDivRef.current);
        } catch (_e) {
          // Ignore if already removed
        }
        vegaDivRef.current = null;
      }

      renderedSpecRef.current = null;
    };
  }, [specString]);

  // Render a minimal container - React only manages this outer div
  // Error and loading states are overlays that don't interfere with vega's DOM
  return (
    <div
      id={chartId}
      className={cn(
        'vega-chart-container relative my-4 mb-6 min-h-[300px] overflow-auto rounded-lg border bg-white p-4',
        className,
      )}
    >
      {/* This div is the mount point for the imperatively created vega container */}
      <div ref={containerRef} className="w-full" />

      {/* Error overlay - positioned absolutely so it doesn't affect vega's DOM */}
      {error && (
        <div className="absolute inset-4 flex items-center justify-center rounded bg-red-50">
          <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
            <p className="font-semibold text-sm">Chart Rendering Error</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* Loading overlay - positioned absolutely so it doesn't affect vega's DOM */}
      {isLoading && !error && (
        <div className="absolute inset-4 flex items-center justify-center bg-white/80">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm">Loading visualization...</p>
          </div>
        </div>
      )}
    </div>
  );
}
