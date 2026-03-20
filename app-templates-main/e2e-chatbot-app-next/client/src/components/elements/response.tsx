import { type ComponentProps, memo } from 'react';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import { Streamdown } from 'streamdown';
import { CollapsibleHtmlTable } from '../collapsible-html-table';
import { useTypewriter } from '@/hooks/useTypewriter';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  (props: ResponseProps) => {
    return (
      <Streamdown
        components={{
          a: DatabricksMessageCitationStreamdownIntegration,
          table: CollapsibleHtmlTable,
        }}
        className="flex flex-col gap-4"
        {...props}
      />
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';

interface StreamingResponseProps extends Omit<ResponseProps, 'children'> {
  children: string;
  isStreaming?: boolean;
  /** Characters to reveal per frame (default: 3) */
  charsPerFrame?: number;
}

/**
 * Response component with smooth typewriter animation for streaming text.
 * Use this instead of Response when you want smoother text appearance.
 */
export const StreamingResponse = memo(
  ({ children, isStreaming = true, charsPerFrame = 3, ...props }: StreamingResponseProps) => {
    const displayedText = useTypewriter(children, {
      isStreaming,
      charsPerFrame,
    });

    return (
      <Streamdown
        components={{
          a: DatabricksMessageCitationStreamdownIntegration,
          table: CollapsibleHtmlTable,
        }}
        className="flex flex-col gap-4"
        {...props}
      >
        {displayedText}
      </Streamdown>
    );
  },
);

StreamingResponse.displayName = 'StreamingResponse';
