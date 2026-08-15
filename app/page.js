export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#101827",
        color: "#ffffff",
        padding: "80px 24px"
      }}
    >
      <section style={{ maxWidth: 900, margin: "0 auto" }}>
        <p
          style={{
            color: "#f4b942",
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase"
          }}
        >
          Ruvanas Platform
        </p>

        <h1 style={{ fontSize: "clamp(42px, 8vw, 78px)", margin: "20px 0" }}>
          The beat of your brand.
        </h1>

        <p style={{ fontSize: 21, lineHeight: 1.6, color: "#cbd5e1" }}>
          Manage online radio, in-house radio, playlists, streaming, and
          branded audio experiences from one professional platform.
        </p>

        <div style={{ display: "flex", gap: 16, marginTop: 36, flexWrap: "wrap" }}>
          <a
            href="/login"
            style={{
              background: "#f4b942",
              color: "#101827",
              padding: "14px 22px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 700
            }}
          >
            Client login
          </a>

          <a
            href="/register"
            style={{
              border: "1px solid #64748b",
              color: "#ffffff",
              padding: "14px 22px",
              borderRadius: 8,
              textDecoration: "none"
            }}
          >
            Get started
          </a>
        </div>
      </section>
    </main>
  );
}
