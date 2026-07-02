/**
 * Normalize LaTeX math delimiters to remark-math-compatible format.
 *
 * DeepSeek-v4 (and many other LLMs) prefer LaTeX-style delimiters:
 *   - \( ... \) for inline math
 *   - \[ ... \] for display math
 *
 * remark-math (v6) only recognizes dollar-sign delimiters:
 *   - $ ... $   for inline math
 *   - $$ ... $$ for display math
 *
 * This function converts the former to the latter so KaTeX rendering
 * works regardless of which delimiter style the model emits.
 *
 * KaTeX command support (like \to, \infty, \binom{n}{k}, \begin{cases},
 * \text, etc.) is handled natively — no normalization needed for those.
 */
export function normalizeLatexDelimiters(text) {
  if (!text || typeof text !== 'string') return text;

  // Replace \[ ... \] → $$ ... $$  (display math)
  // Use a function replacer to avoid $ escaping pitfalls.
  text = text.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_match, math) => `$$${math}$$`,
  );

  // Replace \( ... \) → $ ... $  (inline math)
  text = text.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_match, math) => `$${math}$`,
  );

  return text;
}
