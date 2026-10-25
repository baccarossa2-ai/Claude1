import { useEffect, useRef, useState } from "react";
import { Message } from "./Message.jsx";
import { Cloudee } from "./Cloudee.jsx";
import { Icon } from "./Icons.jsx";
import { useStore } from "../lib/store.js";
import { store } from "../state/store.js";
import { sendMessage } from "../state/send.js";
import { modelInfo } from "../state/models.js";
import { switchMode } from "./Titlebar.jsx";

const SUGGESTIONS = {
  chat: [
    { ico: "✍️", t: "Scrivi un'email", s: "Professionale e cortese", p: "Aiutami a scrivere un'email professionale per chiedere un incontro al mio responsabile." },
    { ico: "🧠", t: "Spiegami un concetto", s: "In parole semplici", p: "Spiegami come funziona l'intelligenza artificiale generativa come se avessi 12 anni." },
    { ico: "🎨", t: "Genera un'immagine", s: "Dal testo all'immagine", p: "Genera un'immagine di una nuvola sorridente che vola sopra una città di notte, stile illustrazione." },
    { ico: "🌐", t: "Crea un sito", s: "Anteprima immediata", p: "Crea una landing page moderna e animata per una gelateria artigianale, in un unico file HTML." },
    { ico: "🔎", t: "Cerca sul web", s: "Con fonti citate", p: "Quali sono le novità più importanti nel mondo dell'AI di questa settimana? Cita le fonti." },
    { ico: "🐧", t: "Usa il tuo computer Linux", s: "Esegui comandi veri", p: "Usa il tuo computer Linux: mostrami la versione del kernel, quanta memoria hai e crea uno script lua che stampa i primi 20 numeri primi." },
  ],
  code: [
    { ico: "🗺️", t: "Esplora il progetto", s: "Struttura e tecnologie", p: "Esplora la cartella di lavoro e spiegami com'è organizzato il progetto e che tecnologie usa." },
    { ico: "🐞", t: "Trova bug", s: "Revisione del codice", p: "Usa la skill code-review e cerca bug e problemi di sicurezza nel codice." },
    { ico: "🧪", t: "Scrivi i test", s: "E falli girare", p: "Aggiungi test automatici per le funzioni principali e eseguili." },
    { ico: "📝", t: "README", s: "Documentazione", p: "Scrivi o migliora il README.md del progetto con istruzioni di installazione e uso." },
  ],
  cowork: [
    { ico: "📊", t: "Analizza dati", s: "CSV, Excel, JSON", p: "Analizza il file di dati che ti allego e preparami un report con grafici." },
    { ico: "🧳", t: "Pianifica un viaggio", s: "Itinerario + budget", p: "Pianifica un viaggio di 4 giorni a Lisbona con budget medio: itinerario giorno per giorno, salvato come documento." },
    { ico: "📑", t: "Prepara una presentazione", s: "Slide in HTML", p: "Prepara una presentazione di 8 slide sull'energia solare come artefatto HTML navigabile." },
    { ico: "🔬", t: "Ricerca approfondita", s: "Report con fonti", p: "Fai una ricerca approfondita sui migliori linguaggi di programmazione da imparare nel 2026 e scrivi un report in markdown nella cartella di lavoro." },
  ],
};

const HEADLINE = { chat: "Di cosa parliamo oggi?", code: "Cosa costruiamo oggi?", cowork: "Su cosa lavoriamo insieme?" };
const SUB = {
  chat: "Chatta con i modelli Cloudy o Claude, allega file e immagini, genera artefatti.",
  code: "Un agente di programmazione come Claude Code, nella cartella che scegli.",
  cowork: "Un collega AI che pianifica, esegue e consegna compiti completi.",
};

function Empty({ conv, mood }) {
  const mode = conv?.mode || "chat";
  const info = modelInfo(conv?.model);
  return (
    <div className="empty">
      <div className="empty-inner">
        <Cloudee mood={mood} size={140} follow />
        <h1>{HEADLINE[mode]}</h1>
        <p className="sub">{SUB[mode]}</p>
        <div className="mode-cards">
          {["chat", "code", "cowork"].map((m) => (
            <button key={m} className={"pill" + (m === mode ? " active" : "")} onClick={() => switchMode(m)} style={m === mode ? { borderColor: "var(--accent)", color: "var(--text)" } : undefined}>
              <Icon name={m} size={14} /> {m === "chat" ? "Chat" : m === "code" ? "Code" : "Cowork"}
            </button>
          ))}
          <span className="pill" title="Modello in uso">
            {info.logo?.src && <img src={info.logo.src} className={info.logo.invertOnLight ? "inv" : ""} alt="" />}
            <span className="name">{info.name}</span>
          </span>
        </div>
        <div className="suggestions">
          {SUGGESTIONS[mode].map((s, i) => (
            <button key={s.t} className="suggestion" style={{ animationDelay: `${120 + i * 60}ms` }} onClick={() => sendMessage(s.p)}>
              <span className="s-ico">{s.ico}</span>
              <span className="s-title">{s.t}</span>
              <span className="s-sub">{s.s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Chat({ mood }) {
  const conv = useStore(store, (s) => s.current);
  const rev = useStore(store, (s) => s.rev);
  const streaming = useStore(store, (s) => !!(s.current && s.streaming[s.current.id]));
  const ref = useRef(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [rev, conv?.id, stick]);

  useEffect(() => setStick(true), [conv?.id]);

  if (!conv || !conv.messages.length) return <Empty conv={conv} mood={mood} />;
  const n = conv.messages.length;
  return (
    <div
      className="chat"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      }}
    >
      <div className="chat-inner">
        {conv.messages.map((m, i) => (
          <Message key={m.id} msg={m} conv={conv} last={i === n - 1} streaming={streaming} rev={i >= n - 2 ? rev : 0} />
        ))}
      </div>
    </div>
  );
}
