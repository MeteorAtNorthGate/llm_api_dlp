import { describe, it, expect } from 'vitest';
import { normalizeLatexDelimiters } from './latex';

describe('normalizeLatexDelimiters', () => {
  it('returns non-string input unchanged', () => {
    expect(normalizeLatexDelimiters(null)).toBe(null);
    expect(normalizeLatexDelimiters(undefined)).toBe(undefined);
    expect(normalizeLatexDelimiters(123)).toBe(123);
  });

  it('returns empty string unchanged', () => {
    expect(normalizeLatexDelimiters('')).toBe('');
  });

  it('converts inline \\(...\\) to $...$', () => {
    expect(normalizeLatexDelimiters('\\(x = y\\)')).toBe('$x = y$');
  });

  it('converts display \\[...\\] to $$...$$', () => {
    expect(normalizeLatexDelimiters('\\[x = y\\]')).toBe('$$x = y$$');
  });

  it('handles multiple inline formulas', () => {
    const input = '\\(a\\) and \\(b\\) and \\(c\\)';
    const expected = '$a$ and $b$ and $c$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('handles mixed inline and display formulas', () => {
    const input = 'Inline: \\(x^2\\), display: \\[\\sum_{i=1}^n i\\]';
    const expected = 'Inline: $x^2$, display: $$\\sum_{i=1}^n i$$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('preserves existing $...$ delimiters', () => {
    const input = '$old$ and \\(new\\)';
    const expected = '$old$ and $new$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('handles LaTeX commands like \\to, \\infty, \\binom', () => {
    const input = '\\(x \\to \\infty\\) and \\(\\binom{n}{k}\\)';
    const expected = '$x \\to \\infty$ and $\\binom{n}{k}$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('handles multiline display math', () => {
    const input = '\\[\\begin{cases} x = 1 \\\\ y = 2 \\end{cases}\\]';
    const expected = '$$\\begin{cases} x = 1 \\\\ y = 2 \\end{cases}$$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('does not modify text without LaTeX delimiters', () => {
    const input = 'Hello world, this is plain text.';
    expect(normalizeLatexDelimiters(input)).toBe(input);
  });

  it('handles escaped backslashes inside math', () => {
    const input = '\\(\\\\text{hello}\\)';
    const expected = '$\\\\text{hello}$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });

  it('handles inline math with nested braces', () => {
    const input = '\\(\\mathbb{E}_{x \\sim P}[f(x)]\\)';
    const expected = '$\\mathbb{E}_{x \\sim P}[f(x)]$';
    expect(normalizeLatexDelimiters(input)).toBe(expected);
  });
});
