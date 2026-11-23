/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        arcane: {
          950: '#090712',
          900: '#110c21',
          800: '#1c1438',
          700: '#2c1e57',
          600: '#5b21b6',
          500: '#7c3aed',
          400: '#a78bfa',
        },
        amberdice: {
          200: '#fde68a',
          400: '#fbbf24',
          500: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
}
