// Launch splash: Cloudee wakes up while the pixel-block "cloudy" wordmark of
// the original TUI (src/tui.js WORDMARK) assembles block by block.
import { useEffect, useState } from "react";
import { Cloudee } from "./Cloudee.jsx";

// Verbatim from original/cloudy-cli/src/tui.js — 7 rows, two-wide strokes.
export const WORDMARK = [
  "                                    ██        ",
  " █████    ██    █████  ██   ██      ██ ██   ██",
  "██   ██   ██   ██   ██ ██   ██  █████  ██   ██",
  "██        ██   ██   ██ ██   ██ ██   ██  █████ ",
  "██   ██   ██   ██   ██ ██   ██ ██   ██    ██  ",
  " █████    ██    █████   █████   █████    ██   ",
  "          ████                                ",
];

export function Wordmark({ px = 7 }) {
  return (
    <div className="wordmark" aria-label="cloudy">
      {WORDMARK.map((row, r) => (
        <div className="wrow" key={r}>
          {[...row].map((ch, c) => (
            <span key={c} className={"px" + (ch === "█" ? " on" : "")} style={{ width: px, height: px, animationDelay: ch === "█" ? `${(c * 18 + r * 30) % 900}ms` : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Splash({ done }) {
  const [leave, setLeave] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    document.getElementById("boot")?.classList.add("gone");
    const t = setTimeout(() => setLeave(true), done ? 1900 : 99999);
    return () => clearTimeout(t);
  }, [done]);
  useEffect(() => {
    if (!leave) return;
    const t = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(t);
  }, [leave]);
  if (gone) return null;
  const small = window.innerWidth < 500;
  return (
    <div className={"splash" + (leave ? " leave" : "")} onClick={() => done && setLeave(true)}>
      <div className="splash-inner">
        <Cloudee mood="waking" size={small ? 120 : 150} />
        <Wordmark px={small ? 5 : 7} />
        <div className="tagline">Chat · Code · Cowork — con Claude e un computer Linux tutto suo</div>
        <div className="loader">
          <i />
        </div>
      </div>
    </div>
  );
}
