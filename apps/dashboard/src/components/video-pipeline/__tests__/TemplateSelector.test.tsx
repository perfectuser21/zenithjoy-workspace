import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TemplateSelector from '../TemplateSelector';

describe('TemplateSelector', () => {
  it('shows all template buttons and no-template option', () => {
    render(<TemplateSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/不使用模板/)).toBeTruthy();
    expect(screen.getAllByText(/W-G/).length).toBeGreaterThan(0);
  });

  it('calls onChange with template id when clicked', () => {
    const onChange = vi.fn();
    render(<TemplateSelector value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(/W-G/));
    expect(onChange).toHaveBeenCalledWith('W-G');
  });

  it('calls onChange with null when no-template clicked', () => {
    const onChange = vi.fn();
    render(<TemplateSelector value="W-G" onChange={onChange} />);
    fireEvent.click(screen.getByText(/不使用模板/));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
