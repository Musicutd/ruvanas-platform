export const metadata = {
  title: {
    default: "Ruvanas | Professional Radio Platforms by 21-Three",
    template: "%s | Ruvanas"
  },
  description: "Professional in-house, retail, School Radio and online radio platforms by 21-Three."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, "Segoe UI", Helvetica, Arial, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
