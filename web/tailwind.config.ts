import type { Config } from 'tailwindcss';

/**
 * Tailwind carries layout only. Every colour, radius, type step and spacing
 * value comes from the Bridge88 tokens in src/bridge88/bridge88.css, so the
 * theme here maps utilities onto those CSS variables rather than defining a
 * second palette that could drift from the design system.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        canvas: 'var(--canvas)',
        primary: 'var(--primary)',
        'on-primary': 'var(--on-primary)',
        'surface-soft': 'var(--surface-soft)',
        hairline: 'var(--hairline)',
        'hairline-soft': 'var(--hairline-soft)',
        magenta: 'var(--accent-magenta)',
        success: 'var(--success)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', pill: 'var(--radius-pill)',
      },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
      maxWidth: { container: 'var(--container-max)' },
    },
  },
  plugins: [],
} satisfies Config;
