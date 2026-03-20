import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

type ConversationProps = ComponentProps<'div'>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <div
    className={cn('relative flex-1', className)}
    role="log"
    {...props}
  />
);

type ConversationContentProps = ComponentProps<'div'>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <div className={cn('p-4', className)} {...props} />
);
