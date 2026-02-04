/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#3467D6',    // 深蓝 - 主色
          secondary: '#3C8CFD',  // 亮蓝 - 中间色
          accent: '#01C7D2',     // 青绿 - 辅助色
        }
      }
    },
  },
  plugins: [],
}
