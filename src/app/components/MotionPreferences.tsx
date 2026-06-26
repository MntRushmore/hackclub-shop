'use client';

import { MotionConfig } from 'framer-motion';

/**
 * Global motion preferences. `reducedMotion="user"` makes every framer-motion
 * animation in the app honor the OS "reduce motion" setting (transform/layout
 * animations collapse to instant, opacity is preserved) without having to guard
 * each `motion.*` individually. Covers page transitions, the cart drawer, card
 * entrances, etc.
 */
export default function MotionPreferences({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
