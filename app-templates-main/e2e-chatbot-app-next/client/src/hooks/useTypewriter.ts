import { useState, useEffect, useRef } from 'react';

interface UseTypewriterOptions {
  /** Characters to reveal per frame (default: 2) */
  charsPerFrame?: number;
  /** Milliseconds between frames (default: 30) */
  frameInterval?: number;
  /** Whether animation is active (set false when streaming is done) */
  isStreaming?: boolean;
}

/**
 * Hook that creates a smooth typewriter effect for streaming text.
 * Instead of showing chunks all at once, it reveals characters gradually
 * at a steady rate for a smoother visual experience.
 */
export function useTypewriter(
  targetText: string,
  options: UseTypewriterOptions = {},
) {
  const {
    charsPerFrame = 2,
    frameInterval = 30, // ~33fps, slower for readability
    isStreaming = true,
  } = options;

  const [displayedText, setDisplayedText] = useState('');
  const displayedLengthRef = useRef(0);
  const targetTextRef = useRef(targetText);
  const animationRef = useRef<number | null>(null);

  // Update target text ref
  targetTextRef.current = targetText;

  // biome-ignore lint/correctness/useExhaustiveDependencies: targetText intentionally accessed via ref to avoid restarting animation on every text update
  useEffect(() => {
    // If not streaming, show full text immediately
    if (!isStreaming) {
      setDisplayedText(targetText);
      displayedLengthRef.current = targetText.length;
      return;
    }

    const animate = () => {
      const target = targetTextRef.current;
      const currentLength = displayedLengthRef.current;

      if (currentLength < target.length) {
        // Reveal more characters
        const newLength = Math.min(currentLength + charsPerFrame, target.length);
        displayedLengthRef.current = newLength;
        setDisplayedText(target.slice(0, newLength));
      }

      // Continue animation if there's more to reveal or we're still streaming
      animationRef.current = window.setTimeout(animate, frameInterval);
    };

    // Start animation
    animationRef.current = window.setTimeout(animate, frameInterval);

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [isStreaming, charsPerFrame, frameInterval]);

  // When streaming ends, ensure we show the complete text
  useEffect(() => {
    if (!isStreaming && displayedText !== targetText) {
      setDisplayedText(targetText);
      displayedLengthRef.current = targetText.length;
    }
  }, [isStreaming, targetText, displayedText]);

  return displayedText;
}
