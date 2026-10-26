// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SettingsMenu from './SettingsMenu';
import { useThemeStore } from '../../store/themeStore';
import { useLanguageStore } from '../../store/languageStore';

beforeEach(() => {
  useThemeStore.setState({ design: 'neumorphism', colorMode: 'light' });
  useLanguageStore.setState({ language: 'zh' });
});
afterEach(cleanup);

describe('appearance settings', () => {
  it('switches style and color mode independently while keeping controls open', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole('button', { name: '页面选项' }));
    fireEvent.click(screen.getByRole('radio', { name: /扁平化/ }));
    expect(document.documentElement.dataset.theme).toBe('llm');
    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(document.documentElement.dataset.theme).toBe('llmDark');
    fireEvent.click(screen.getByRole('radio', { name: /新拟态/ }));
    expect(document.documentElement.dataset.theme).toBe('llmSoftDark');
    expect(screen.getByRole('radio', { name: '深色' }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeDefined();
  });

  it('switches language without losing appearance or closing the panel', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole('button', { name: '页面选项' }));
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('radio', { name: /Neumorphism/ }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: 'Light' }).checked).toBe(true);
    expect(useThemeStore.getState().design).toBe('neumorphism');
  });

  it('closes with Escape and restores focus to the trigger', () => {
    render(<SettingsMenu />);
    const trigger = screen.getByRole('button', { name: '页面选项' });
    fireEvent.click(trigger);
    screen.getByRole('radio', { name: '深色' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radio', { name: '深色' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on outside click', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole('button', { name: '页面选项' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('radio', { name: '深色' })).toBeNull();
  });
});
