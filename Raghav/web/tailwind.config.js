/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Clinical, calm palette — slate + teal accent (not purple)
        ink: '#0f172a',
        mist: '#f1f5f9',
        foam: '#e2e8f0',
        teal: {
          DEFAULT: '#0f766e',
          soft: '#ccfbf1',
          deep: '#115e59',
        },
        alert: {
          DEFAULT: '#b45309',
          soft: '#ffedd5',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
