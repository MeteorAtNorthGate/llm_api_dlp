// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// Vitest globals are off, so @testing-library's automatic cleanup never
// registers — without this the previous test's DOM leaks into the next one.
afterEach(cleanup);

import Toast from './Toast';

describe('Toast', () => {
  it('renders the message and dismisses itself after the duration', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <Toast message="检测到 2 处敏感信息" duration={5000} onDismiss={onDismiss} />
      );

      expect(screen.getByText('检测到 2 处敏感信息')).toBeDefined();
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drives the countdown bar from full width toward zero', () => {
    // jsdom's fake timers do not drive requestAnimationFrame, so run it inline.
    // The component uses rAF to let the browser paint the initial 100% before
    // the width transition starts.
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });

    try {
      const { container } = render(
        <Toast message="x" duration={4000} onDismiss={() => {}} />
      );
      const bar = container.querySelector('.bg-primary');

      // jsdom does not run transitions, so assert the end state and the
      // duration that drives it, plus the left anchor that makes it shrink
      // from the right rather than from the left.
      expect(bar.style.transitionDuration).toBe('4000ms');
      expect(bar.className).toContain('left-0');
      expect(bar.style.width).toBe('0%');
    } finally {
      raf.mockRestore();
    }
  });
});
