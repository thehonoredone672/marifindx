/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EBF4FF',
          100: '#D6E8FF',
          500: '#3BA7F2',
          600: '#0B3D91',
          900: '#051F52',
        },
        accent: '#7FE7D6',
        dark: {
          50: '#0f1419',
          100: '#1a2332',
          200: '#2d3a4d',
        },
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '20px',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
