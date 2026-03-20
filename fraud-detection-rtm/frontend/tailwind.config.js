/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "db-red": "#FF3621",
        "db-dark": "#1B3139",
        "db-gray": "#F5F5F5",
      },
    },
  },
  plugins: [],
};
