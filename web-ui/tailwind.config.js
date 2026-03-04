/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0f172a',
        secondary: '#1e293b',
        accent: '#06b6d4',
        bitcoin: '#f7931a',
        lightning: '#f59e0b',
        satoshi: '#ff9500',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
