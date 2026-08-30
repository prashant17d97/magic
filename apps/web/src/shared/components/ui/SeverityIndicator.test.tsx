import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '@/test/render';
import { SeverityIndicator } from './SeverityIndicator';

describe('SeverityIndicator', () => {
  it('carries a text label so severity never depends on colour alone', () => {
    renderWithProviders(<SeverityIndicator severity="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('keeps an accessible description even when the label is hidden', () => {
    renderWithProviders(<SeverityIndicator severity="high" showLabel={false} />);
    expect(screen.getByText(/High severity: Likely discrepancy/i)).toBeInTheDocument();
  });

  it('describes what each severity means rather than only naming it', () => {
    renderWithProviders(<SeverityIndicator severity="critical" />);
    expect(screen.getByTitle(/money is provably missing/i)).toBeInTheDocument();
  });
});
