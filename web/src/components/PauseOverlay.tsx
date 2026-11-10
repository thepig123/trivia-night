import React from "react";
export default function PauseOverlay({paused}:{paused:boolean}) {
  if(!paused)return null;
  return <section className="pause-overlay" role="dialog" aria-modal="true" aria-label="Spillet er satt på pause"><div><small>TA EN PUST I BAKKEN</small><h1>PAUSE</h1><p>Verten fortsetter spillet når alle er klare.</p></div></section>;
}
