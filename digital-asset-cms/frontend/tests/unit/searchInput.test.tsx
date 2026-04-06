/**
 * 12.T2 — Search input debounce
 *
 * Renders SearchInput, types rapidly, asserts the callback fires
 * only once after the 300ms debounce window.
 */
import { act, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../../src/components/SearchInput';

describe('SearchInput debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onSearch only once after 300ms when typing rapidly', () => {
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);
    const input = screen.getByRole('textbox');

    // Simulate rapid typing
    fireEvent.change(input, { target: { value: 'n' } });
    fireEvent.change(input, { target: { value: 'na' } });
    fireEvent.change(input, { target: { value: 'nav' } });

    // No call yet
    expect(onSearch).not.toHaveBeenCalled();

    // Advance past the debounce window
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('nav');
  });

  it('fires again after a second burst of typing', () => {
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'nav' } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(onSearch).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: 'navy polo' } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith('navy polo');
  });

  it('does not fire if typing stops before 300ms', () => {
    const onSearch = vi.fn();
    render(<SearchInput onSearch={onSearch} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => { vi.advanceTimersByTime(150); });

    expect(onSearch).not.toHaveBeenCalled();
  });
});
