'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'compact' | 'default' | 'comfortable';
export type Theme = 'system' | 'light' | 'dark';

interface ConsoleState {
  density: Density;
  theme: Theme;
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  selection: Set<string>;
  setDensity(density: Density): void;
  setTheme(theme: Theme): void;
  toggleSidebar(): void;
  setCommandPaletteOpen(open: boolean): void;
  toggleSelected(id: string): void;
  setSelection(ids: string[]): void;
  clearSelection(): void;
}

/**
 * Client UI state only. Server data never lives here — it belongs to the query cache, and mixing
 * the two is how a table starts showing figures that no longer match the database.
 *
 * Selection is a Set so a row can read one boolean through a narrow selector instead of
 * re-rendering every row whenever any checkbox moves.
 */
export const useConsoleStore = create<ConsoleState>()(
  persist(
    (set) => ({
      density: 'default',
      theme: 'system',
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      selection: new Set<string>(),

      setDensity: (density) => set({ density }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

      toggleSelected: (id) =>
        set((state) => {
          const next = new Set(state.selection);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selection: next };
        }),

      setSelection: (ids) => set({ selection: new Set(ids) }),
      clearSelection: () => set({ selection: new Set<string>() }),
    }),
    {
      name: 'magic.console',
      partialize: (state) => ({
        density: state.density,
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
