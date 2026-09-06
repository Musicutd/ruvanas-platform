import OfflineActions from "./OfflineActions";

export const metadata = { title: "Offline | Ruvanas", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return <main style={styles.page}><section style={styles.card}><div style={styles.mark}>R</div><p style={styles.eyebrow}>RUVANAS MOBILE</p><h1 style={styles.title}>The station is temporarily out of reach.</h1><p style={styles.copy}>Your saved public station page may still be available. Live audio, current programme information and account tools need a connection and will resume safely when you are back online.</p><OfflineActions /><p style={styles.note}>No private account information or audio is stored for offline use.</p></section></main>;
}

const styles = { page: { minHeight: "100vh", display: "grid", placeItems: "center", boxSizing: "border-box", padding: 24, background: "radial-gradient(circle at 80% 10%, #233b61, #07101d 48%)", color: "#f8fafc", fontFamily: "Inter, Segoe UI, Arial, sans-serif" }, card: { width: "min(700px, 100%)", padding: "clamp(28px, 7vw, 62px)", boxSizing: "border-box", border: "1px solid #30425f", borderRadius: 24, background: "rgba(11,21,38,.88)", boxShadow: "0 30px 90px rgba(0,0,0,.3)" }, mark: { width: 54, height: 54, display: "grid", placeItems: "center", borderRadius: 15, background: "#f4b942", color: "#07101d", fontSize: 26, fontWeight: 950 }, eyebrow: { margin: "30px 0 10px", color: "#f4b942", fontSize: 11, fontWeight: 950, letterSpacing: 1.7 }, title: { margin: 0, fontSize: "clamp(38px, 7vw, 66px)", lineHeight: 1, letterSpacing: "-.045em" }, copy: { color: "#b8c5d7", fontSize: 18, lineHeight: 1.65 }, note: { marginTop: 30, color: "#8194af", fontSize: 12 } };
