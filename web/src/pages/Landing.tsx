import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="screen" style={{ justifyContent: "center" }}>
      <h1 className="brand">TRIVIA NIGHT</h1>
      <p className="brand-sub">Answer. Climb. Win the room.</p>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Link to="/join" className="btn pink">
          I'm on a team
        </Link>
        <Link to="/host" className="btn violet">
          I'm hosting
        </Link>
      </div>
    </div>
  );
}
