/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // One tinted neutral ramp. Surfaces step by 4px and by one tone.
        paper: {
          0: '#ffffff',
          50: '#f7f7f8',
          100: '#f0f0f2',
          200: '#e6e6ea',
        },
        ink: {
          900: '#18181b',
          700: '#35353b',
          500: '#5c5c66',
          400: '#8a8a94',
        },
        line: 'rgba(24, 24, 27, 0.10)',
        // One accent, used only on the primary action, active state and one figure.
        accent: {
          DEFAULT: '#e11d62',
          soft: '#fdf0f5',
          ink: '#b81450',
        },
        // Functional status tones: quiet, never decorative.
        good: {
          DEFAULT: '#3f6b57',
          soft: '#eff5f1',
        },
        warn: {
          DEFAULT: '#7d601f',
          soft: '#faf4e7',
        },
        bad: {
          DEFAULT: '#8f4149',
          soft: '#f9eff0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['SFMono-Regular', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
