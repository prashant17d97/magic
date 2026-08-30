import { cn } from '@/shared/lib/cn';

/**
 * All caps with generous tracking is where Sora's geometry is strongest. There is no icon mark:
 * a wordmark ages better than a hurried symbol, and a literal sparkle or wand would undercut the
 * seriousness this product depends on.
 *
 * The short mark is not only for the collapsed rail. Below the medium breakpoint the rail is
 * always narrow, and since that is a CSS decision the full wordmark cannot be swapped out in
 * JavaScript: both marks are rendered and CSS chooses, which keeps the server and client output
 * identical.
 */
export function Wordmark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span
      className={cn('font-[family-name:var(--font-sora)] font-bold', className)}
      style={{ color: 'var(--text-brand)' }}
    >
      {collapsed ? (
        <span className="text-[15px] tracking-[0.06em]">M</span>
      ) : (
        <>
          <span className="text-[17px] tracking-[0.14em] max-md:hidden">MAGIC</span>
          <span className="hidden text-[15px] tracking-[0.06em] max-md:inline">M</span>
        </>
      )}
    </span>
  );
}
