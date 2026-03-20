import type { ChatMessage } from '@chat-template/core';
import type {
  AnchorHTMLAttributes,
  ComponentType,
  PropsWithChildren,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * ReactMarkdown/Streamdown component that handles Databricks message citations.
 *
 * @example
 * <Streamdown components={{ a: DatabricksMessageCitationStreamdownIntegration }} />
 */
export const DatabricksMessageCitationStreamdownIntegration: ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement>
> = (props) => {
  if (isDatabricksMessageCitationLink(props.href)) {
    return (
      <DatabricksMessageCitationRenderer
        {...props}
        href={decodeDatabricksMessageCitationLink(props.href)}
      />
    );
  }
  return <DefaultAnchor {...props} />;
};

// const isFootnoteLink

type SourcePart = Extract<ChatMessage['parts'][number], { type: 'source-url' }>;

// Adds a unique suffix to the link to indicate that it is a Databricks message citation.
const encodeDatabricksMessageCitationLink = (part: SourcePart) =>
  `${part.url}::databricks_citation`;

// Removes the unique suffix from the link to get the original link.
const decodeDatabricksMessageCitationLink = (link: string) =>
  link.replace('::databricks_citation', '');

// Creates a markdown link to the Databricks message citation.
export const createDatabricksMessageCitationMarkdown = (part: SourcePart) => {
  const label = part.title || part.url || 'Source';
  return `[${label}](${encodeDatabricksMessageCitationLink(part)})`;
};

// Checks if the link is a Databricks message citation.
const isDatabricksMessageCitationLink = (
  link?: string,
): link is `${string}::databricks_citation` =>
  link?.endsWith('::databricks_citation') ?? false;

// Renders the Databricks message citation.
const DatabricksMessageCitationRenderer = (
  props: PropsWithChildren<{
    href: string;
  }>,
) => {
  const hasUrl = props.href && props.href.length > 0;

  // When the endpoint returns empty URLs, render as a non-clickable badge
  if (!hasUrl) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default rounded-md bg-muted px-2 py-0 text-muted-foreground text-xs">
            {props.children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          style={{ maxWidth: '300px', padding: '8px', wordWrap: 'break-word' }}
        >
          Source (no URL available)
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DefaultAnchor
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-muted-foreground px-2 py-0 text-zinc-200"
        >
          {props.children}
        </DefaultAnchor>
      </TooltipTrigger>
      <TooltipContent
        style={{ maxWidth: '300px', padding: '8px', wordWrap: 'break-word' }}
      >
        {props.href}
      </TooltipContent>
    </Tooltip>
  );
};

// Copied from streamdown
// https://github.com/vercel/streamdown/blob/dc5bd12e5709afce09814e47cf80884f8c665b3d/packages/streamdown/lib/components.tsx#L157-L181
const DefaultAnchor: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>> = (
  props,
) => {
  const isIncomplete = props.href === 'streamdown:incomplete-link';
  const isFootnoteLink = props.href?.startsWith('#');

  return (
    <a
      className={cn(
        'wrap-anywhere font-medium text-primary underline',
        props.className,
      )}
      data-incomplete={isIncomplete}
      data-streamdown="link"
      href={props.href}
      {...props}
      {...(isFootnoteLink
        ? {
            target: '_self',
          }
        : {
            target: '_blank',
            rel: 'noopener noreferrer',
          })}
    >
      {props.children}
    </a>
  );
};
