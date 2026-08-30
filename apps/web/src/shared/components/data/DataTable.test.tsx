import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, within } from '@/test/render';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: string;
  name: string;
  amount: string;
}

const rows: Row[] = [
  { id: 'a', name: 'Acme Studio', amount: '1200' },
  { id: 'b', name: 'Brightside', amount: '400' },
];

const columns: Column<Row>[] = [
  { id: 'name', header: 'Account', width: '200px', cell: (row) => row.name },
  { id: 'amount', header: 'Exposure', width: '100px', align: 'right', sortable: true, cell: (row) => row.amount },
];

describe('DataTable', () => {
  it('renders real table semantics so a screen reader can navigate the ledger', () => {
    renderWithProviders(
      <DataTable caption="Exceptions" columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );

    const table = screen.getByRole('table', { name: 'Exceptions' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('reports sort state through aria-sort rather than only through an icon', async () => {
    const onSortChange = vi.fn();
    renderWithProviders(
      <DataTable
        caption="Exceptions"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ column: 'amount', direction: 'desc' }}
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByRole('columnheader', { name: /exposure/i })).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(screen.getByRole('button', { name: /exposure/i }));
    expect(onSortChange).toHaveBeenCalledWith('amount');
  });

  it('opens a row on click and reports which row is selected', async () => {
    const onRowClick = vi.fn();
    renderWithProviders(
      <DataTable
        caption="Exceptions"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedId="a"
        onRowClick={onRowClick}
      />,
    );

    await userEvent.click(screen.getByText('Brightside'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);

    const selected = screen.getByText('Acme Studio').closest('tr');
    expect(selected).toHaveAttribute('aria-selected', 'true');
  });

  it('selects rows without the checkbox click bubbling into opening the row', async () => {
    const onToggleSelect = vi.fn();
    const onRowClick = vi.fn();

    renderWithProviders(
      <DataTable
        caption="Exceptions"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selection={new Set<string>()}
        onToggleSelect={onToggleSelect}
        onRowClick={onRowClick}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(onToggleSelect).toHaveBeenCalledWith('a');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows the empty state instead of an empty grid', () => {
    renderWithProviders(
      <DataTable
        caption="Exceptions"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyState={<p>No open exceptions</p>}
      />,
    );

    expect(screen.getByText('No open exceptions')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
