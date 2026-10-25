// Cloudee — Cloudy's real mascot, rendered by the avatar runtime cloudy.chat
// ships (assets/vendor/cloudee-avatar.mjs, 23 animations). `mood` picks the
// animation; the eyes follow the pointer when `follow` is on.
import { useEffect, useRef } from "react";

let runtime = null;
export function loadCloudee() {
  if (!runtime) runtime = import(/* webpackIgnore: true */ new URL("assets/vendor/cloudee-avatar.mjs", location.href).href);
  return runtime;
}

export const MOODS = ["sleeping", "waking", "idle", "listening", "thinking", "searching", "working", "excited", "bored", "suspicious", "angry", "drowsy", "happy", "curious", "confused", "surprised", "proud", "shy", "sad", "laughing", "scared", "playful", "celebrate"];

export function Cloudee({ mood = "idle", size = 120, follow = false, className = "", onClick, title = "Cloudee", rest = false }) {
  const host = useRef(null);
  const api = useRef(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    let dead = false;
    loadCloudee()
      .then(({ createAvatar }) => {
        if (dead || !host.current) return;
        api.current = createAvatar(host.current, { animation: MOODS.includes(moodRef.current) ? moodRef.current : "idle", autoplay: !rest, size: "100%" });
        if (rest) api.current.holdRest?.();
      })
      .catch(() => {
        if (host.current) host.current.innerHTML = '<img src="assets/logos/cloudee-256.png" style="width:100%;height:100%" alt="">';
      });
    return () => {
      dead = true;
      api.current?.destroy();
      api.current = null;
    };
  }, [rest]);

  useEffect(() => {
    const a = api.current;
    if (!a || rest) return;
    try {
      a.play(MOODS.includes(mood) ? mood : "idle");
    } catch {
      /* unknown animation name */
    }
  }, [mood, rest]);

  useEffect(() => {
    if (!follow || document.documentElement.dataset.motion === "reduced") return;
    const onMove = (e) => {
      const el = host.current;
      if (!el || !api.current?.lookAt) return;
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
      api.current.lookAt(nx, ny, 1);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [follow]);

  return <span ref={host} className={"cloudee " + className} style={{ width: size, height: size }} onClick={onClick} title={title} role="img" aria-label={title} />;
}
