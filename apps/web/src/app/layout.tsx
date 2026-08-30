import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Sora } from 'next/font/google';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import '@/styles/globals.css';
import { AppProviders } from '@/providers/AppProviders';

/**
 * Font Awesome injects its own stylesheet at runtime by default, which arrives after first paint
 * and makes every icon flash at full size. Next already ships the stylesheet above, so the
 * runtime injection is switched off.
 */
config.autoAddCss = false;

/**
 * Sora carries the brand; Inter carries the work.
 *
 * Sora is a geometric display face with wide letterforms — excellent above 20px and poor in a
 * 13px data grid. Fighting it into the table would cost legibility for a font choice nobody can
 * see at that size. JetBrains Mono handles identifiers, where distinguishing 0 from O and 1 from
 * l is not a nicety.
 */
const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap', weight: ['400', '600', '700'] });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: { default: 'MAGIC Console', template: '%s · MAGIC' },
  description: 'Reconciliation console for Stripe Connect platforms.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F6FA' },
    { media: '(prefers-color-scheme: dark)', color: '#080B12' },
  ],
};

/**
 * The theme and density are applied by a blocking inline script before paint. Reading them in
 * React would show a flash of the wrong theme on every load, which in a tool people keep open all
 * day is a small betrayal of the calm the product is trying to project.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem('magic.console') || '{}');
    var state = stored.state || {};
    var theme = state.theme || 'system';
    var density = state.density || 'default';
    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', density);
  } catch (error) {
    document.documentElement.setAttribute('data-density', 'default');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sora.variable} ${inter.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[999] focus:rounded-[var(--radius-sm)] focus:bg-[var(--bg-surface)] focus:px-3 focus:py-2 focus:type-body-sm focus:shadow-[var(--shadow-md)]"
        >
          Skip to main content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
