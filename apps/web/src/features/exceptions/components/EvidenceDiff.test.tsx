import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '@/test/render';
import { EvidenceDiff } from './EvidenceDiff';

describe('EvidenceDiff', () => {
  it('renders expected, actual and the difference as aligned money', () => {
    renderWithProviders(
      <EvidenceDiff
        expected={{ amount_minor: '120000' }}
        actual={{ amount_minor: '78750' }}
        currency="USD"
      />,
    );

    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('$787.50')).toBeInTheDocument();
    expect(screen.getByText('-$412.50')).toBeInTheDocument();
  });

  it('shows a positive difference with an explicit sign', () => {
    renderWithProviders(
      <EvidenceDiff expected={{ fee_minor: '1000' }} actual={{ fee_minor: '1500' }} currency="USD" />,
    );

    expect(screen.getByText('+$5.00')).toBeInTheDocument();
  });

  it('renders non-money evidence without inventing a difference', () => {
    renderWithProviders(
      <EvidenceDiff expected={{ transfer_found: true }} actual={{ transfer_found: false }} currency="USD" />,
    );

    expect(screen.getByText('yes')).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('says so plainly when a rule recorded no comparable figures', () => {
    renderWithProviders(<EvidenceDiff expected={{}} actual={{}} currency={null} />);
    expect(screen.getByText(/no comparable figures/i)).toBeInTheDocument();
  });
});
