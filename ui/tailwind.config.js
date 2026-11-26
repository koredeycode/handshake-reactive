/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          0: '#ffffff',
          50: '#f8f7f4',
          100: '#f2f0eb',
          200: '#e9e6df',
        },
        ink: {
          900: '#161a1f',
          700: '#2f363f',
          500: '#4d545e',
          400: '#6c747e',
        },
        line: 'rgba(22, 26, 31, 0.12)',
        accent: {
          DEFAULT: '#1f4570',
          soft: '#edf2f8',
          ink: '#173454',
        },
        good: {
          DEFAULT: '#2f6b4f',
          soft: '#edf5f0',
        },
        warn: {
          DEFAULT: '#8a5a12',
          soft: '#faf3e6',
        },
        bad: {
          DEFAULT: '#9b3a3a',
          soft: '#f9eded',
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
