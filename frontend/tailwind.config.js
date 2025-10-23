/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#7C3AED",
        },
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #0B1220 0%, #111827 50%, #0F172A 100%)",
        "text-gradient": "linear-gradient(90deg, #7C3AED 0%, #22D3EE 100%)",
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(0,0,0,0.45)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
