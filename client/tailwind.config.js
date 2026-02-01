/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        forest: {
          light: '#4ade80',
          DEFAULT: '#22c55e',
          dark: '#15803d',
        },
        baikal: {
          light: '#38bdf8',
          DEFAULT: '#0ea5e9',
          dark: '#0369a1',
        },
      },
    },
  },
  plugins: [],
};
