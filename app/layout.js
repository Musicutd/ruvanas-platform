export const metadata = {
  title: "Ruvanas Platform",
  description: "Professional online radio and in-house radio management"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
