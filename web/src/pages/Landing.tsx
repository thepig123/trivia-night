import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="screen" style={{ justifyContent: "center" }}>
      <h1 className="brand">TRIVIA NIGHT</h1>
      <p className="brand-sub">Svar. Klatre. Vinn kvelden.</p>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Link to="/join" className="btn pink">
          Jeg er på et lag
        </Link>
        <Link to="/host" className="btn violet">
          Jeg er vert
        </Link>
        <Link to="/tv" className="btn ghost">
          Åpne TV-skjermen
        </Link>
      </div>
    </div>
  );
}
