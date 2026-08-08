/**
 * Map bodies are markdown, but a one-line gist renders as plain text — so inline emphasis,
 * code ticks, and links are stripped down to their words. This is display flattening, not a
 * markdown parser; block syntax never reaches a gist.
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}
