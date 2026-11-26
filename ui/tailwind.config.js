/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b12',
          900: '#0b111c',
          850: '#0e1624',
          800: '#131d2e',
          700: '#1c2940',
          600: '#293a56',
        },
        reactive: '#8b7cf6',
        payment: '#45b6f5',
        asset: '#f5a94b',
        good: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -20px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(139,124,246,0.25), 0 0 32px -8px rgba(139,124,246,0.35)',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.25s ease-out both',
      },
    },
  },
  plugins: [],
}
