// Built-in skills. The model sees each name + description in its system prompt
// and loads the full body with the `use_skill` tool when a task matches —
// the same contract as the original's .cloudy/skills/*.md.
const S = (name, icon, category, description, content) => ({ name, icon, category, description, content: content.trim(), builtin: true });

export const BUILTIN_SKILLS = [
  S("code-review", "🔍", "Sviluppo", "Revisione del codice: bug, sicurezza, leggibilità, con correzioni proposte.", `
# Revisione del codice
1. Leggi i file coinvolti per intero prima di giudicare (read_file / search_files).
2. Cerca prima i difetti che cambiano il comportamento: logica errata, casi limite, null/undefined, errori off-by-one, race condition, gestione errori assente.
3. Poi sicurezza: input non validati, injection (SQL, shell, HTML), segreti nel codice, permessi.
4. Poi manutenibilità: duplicazioni, nomi poco chiari, funzioni troppo lunghe.
5. Per ogni problema: file:riga, perché è un problema, uno scenario concreto che lo fa fallire, la correzione minima.
6. Ordina per gravità (🔴 bloccante, 🟡 da sistemare, 🔵 suggerimento). Non inventare problemi: se il codice è buono, dillo.`),
  S("debug", "🐞", "Sviluppo", "Debug sistematico di errori, crash e comportamenti strani.", `
# Debug sistematico
1. Riproduci: chiedi o trova il comando esatto e l'output d'errore completo.
2. Leggi lo stack trace dall'alto: individua la prima riga nel codice dell'utente.
3. Formula 2-3 ipotesi ordinate per probabilità; verifica la più probabile con il minimo esperimento (log, test, comando).
4. Correggi la causa, non il sintomo. Una modifica alla volta.
5. Verifica: riesegui il comando che falliva e mostra che ora passa.
6. Spiega in parole semplici cosa era rotto e perché la correzione funziona.`),
  S("write-tests", "🧪", "Sviluppo", "Scrivere test automatici affidabili (unit, integrazione).", `
# Scrivere test
- Individua il framework già usato dal progetto (package.json, pytest.ini, go.mod…). Non introdurne uno nuovo senza motivo.
- Un test per comportamento: caso normale, casi limite, casi d'errore.
- Nomi dei test che descrivono il comportamento atteso.
- Niente dipendenze da rete/orario: usa mock o valori fissi.
- Esegui i test (self_test o run_command) e riporta l'esito reale.`),
  S("refactor", "🧹", "Sviluppo", "Ripulire e riorganizzare codice senza cambiarne il comportamento.", `
# Refactoring sicuro
1. Assicurati che esistano test o crea un controllo rapido prima di toccare il codice.
2. Piccoli passi: rinomina, estrai funzione, rimuovi duplicazione — uno alla volta.
3. Nessun cambiamento di comportamento: stesso input, stesso output.
4. Riesegui i test dopo ogni passo. Riassumi le modifiche alla fine.`),
  S("security-audit", "🛡️", "Sviluppo", "Cercare vulnerabilità e segreti esposti nel proprio codice.", `
# Audit di sicurezza
Controlla: segreti/API key nel repository (search_files per "key", "secret", "token", "password"), dipendenze vulnerabili note, input non validato verso shell/SQL/HTML/percorsi file, autenticazione e autorizzazione, CORS e header, upload di file, deserializzazione, log con dati sensibili.
Per ogni rischio: gravità, dove, come sfruttarlo (in breve), come correggerlo. Mai eseguire attacchi contro sistemi di terzi.`),
  S("git-helper", "🌿", "Sviluppo", "Commit, branch, merge, rebase e recupero da errori Git.", `
# Git
- Prima di tutto: git status e git log --oneline -10 per capire lo stato.
- Messaggi di commit: imperativo, breve riga di sintesi, poi il perché.
- Operazioni distruttive (reset --hard, push --force, clean -fd): spiega il rischio e chiedi conferma.
- Per annullare: preferisci git revert su branch condivisi; reflog per recuperare commit "persi".`),
  S("web-app", "🌐", "Sviluppo", "Creare siti e web app moderne (HTML/CSS/JS, React, Vite).", `
# Creare una web app
- Chiarisci obiettivo, pagine e stile. Proponi una struttura di file.
- Per prototipi rapidi: un singolo file HTML con CSS e JS inline, e mostralo con create_artifact (kind html).
- Per progetti veri: Vite + framework scelto, struttura src/, componenti piccoli.
- Design: responsive (mobile first), contrasto leggibile, spaziature coerenti, stati hover/focus, animazioni discrete.
- Accessibilità: etichette, alt sulle immagini, navigazione da tastiera.`),
  S("python-script", "🐍", "Sviluppo", "Script Python puliti con gestione errori e argomenti da riga di comando.", `
# Script Python
- Python 3, solo libreria standard se possibile; dichiara le dipendenze esterne.
- argparse per gli argomenti, logging o print chiari, main() con if __name__ == "__main__".
- Gestisci file mancanti e input errati con messaggi comprensibili.
- Se l'utente non ha Python, ricorda che il computer Linux integrato ha lua/awk/sh: proponi l'alternativa.`),
  S("sql-expert", "🗄️", "Dati", "Scrivere, spiegare e ottimizzare query SQL.", `
# SQL
- Chiedi o deduci il dialetto (PostgreSQL, MySQL, SQLite, SQL Server).
- Query leggibili: una clausola per riga, alias chiari, CTE per i passaggi complessi.
- Spiega cosa restituisce la query. Per le prestazioni: indici, EXPLAIN, evitare SELECT *.
- Mai DELETE/UPDATE senza WHERE: segnalalo sempre.`),
  S("data-analysis", "📊", "Dati", "Analizzare CSV/JSON/Excel: statistiche, tendenze, grafici.", `
# Analisi dati
1. Ispeziona il file: colonne, tipi, righe, valori mancanti.
2. Statistiche descrittive pertinenti (conteggi, medie, mediane, distribuzioni, top N).
3. Rispondi alla domanda dell'utente con numeri verificabili.
4. Visualizza: crea un grafico con create_artifact (html con <canvas> o SVG) quando aiuta.
5. Indica limiti e anomalie dei dati.`),
  S("excel-formulas", "📗", "Dati", "Formule Excel/Google Sheets, tabelle pivot e automazioni.", `
# Formule fogli di calcolo
Dai la formula pronta da incollare, spiega ogni argomento, indica la versione (Excel 365, 2019, Google Sheets) e alternative (CERCA.X vs CERCA.VERT). Usa i nomi delle funzioni nella lingua dell'utente se la chiede (italiano: SOMMA.SE, SE.ERRORE…).`),
  S("regex", "🔣", "Dati", "Creare e spiegare espressioni regolari.", `
# Espressioni regolari
Fornisci la regex, una spiegazione pezzo per pezzo, 3 esempi che corrispondono e 2 che non corrispondono, e il dialetto (JavaScript, Python, PCRE). Evita il backtracking catastrofico.`),
  S("writing-pro", "✍️", "Scrittura", "Testi professionali: articoli, email, post, relazioni.", `
# Scrittura professionale
- Chiedi o deduci pubblico, scopo, tono e lunghezza.
- Struttura: titolo chiaro, apertura che va al punto, paragrafi brevi, conclusione con azione.
- Frasi attive e concrete, niente riempitivi. Rileggi per coerenza e refusi.
- Offri 2 varianti di titolo/oggetto quando utile.`),
  S("email-writer", "📧", "Scrittura", "Email efficaci: richieste, solleciti, risposte difficili.", `
# Email
Oggetto specifico; prima riga = la richiesta o la notizia; contesto minimo; una sola call-to-action con scadenza; chiusura cortese. Tono adatto al destinatario (formale/informale). Proponi anche una versione più breve.`),
  S("translator", "🌍", "Scrittura", "Traduzioni naturali che mantengono tono e significato.", `
# Traduzione
Traduci il significato, non parola per parola. Mantieni tono, registro e formattazione (markdown, elenchi). Segnala modi di dire o giochi di parole intraducibili e proponi un equivalente. Per termini tecnici mantieni l'originale tra parentesi la prima volta.`),
  S("summarizer", "🧾", "Scrittura", "Riassunti chiari di documenti, articoli, riunioni.", `
# Riassunto
Inizia con una frase di sintesi (TL;DR), poi i punti chiave in elenco, poi decisioni/azioni con responsabili e date se presenti. Non aggiungere informazioni assenti dal testo. Lunghezza: circa il 10-20% dell'originale salvo richiesta diversa.`),
  S("storyteller", "📖", "Creatività", "Racconti, sceneggiature, poesie e mondi narrativi.", `
# Narrativa
Definisci genere, pubblico, punto di vista. Personaggi con desideri e conflitti; mostra, non dire; dialoghi vivi; ritmo variato; finale coerente. Chiedi se l'utente vuole continuare la storia o cambiarne la direzione.`),
  S("marketing-copy", "📣", "Business", "Copy pubblicitari, landing page, slogan, social.", `
# Copywriting
Formula: problema → promessa → prova → azione. Parla dei benefici, non delle caratteristiche. Titoli con numeri o domande, CTA chiare. Fornisci 3-5 varianti per A/B test e adatta la lunghezza alla piattaforma (Instagram, LinkedIn, Google Ads, X).`),
  S("seo", "📈", "Business", "Ottimizzazione SEO di pagine e articoli.", `
# SEO
Parola chiave principale e correlate; title ≤ 60 caratteri; meta description ≤ 155; un H1, H2 logici; URL brevi; testo che risponde all'intento di ricerca; link interni; dati strutturati quando utili; immagini con alt. Niente keyword stuffing.`),
  S("business-plan", "💼", "Business", "Business plan, analisi di mercato, pitch per investitori.", `
# Business plan
Sezioni: problema, soluzione, mercato (TAM/SAM/SOM con fonti o ipotesi dichiarate), clienti, concorrenza, modello di ricavi, go-to-market, team, piano finanziario a 3 anni con ipotesi esplicite, rischi. Distingui sempre fatti da stime.`),
  S("presentation", "🎤", "Business", "Scaletta e contenuti per presentazioni efficaci.", `
# Presentazione
Una idea per slide, titolo-affermazione, max 3-5 punti, numeri grandi e grafici semplici. Struttura: aggancio, problema, soluzione, prova, chiamata all'azione. Aggiungi note del relatore. Se utile, genera le slide come artifact HTML.`),
  S("teacher", "🎓", "Studio", "Spiegare qualsiasi argomento passo passo, con esempi ed esercizi.", `
# Insegnante
Parti da ciò che l'utente sa già. Spiega con un'analogia, poi la definizione precisa, poi un esempio svolto. Verifica la comprensione con 2-3 domande. Proponi esercizi graduati e correggi con gentilezza.`),
  S("math-solver", "➗", "Studio", "Risolvere problemi di matematica e fisica mostrando i passaggi.", `
# Matematica
Scrivi dati e incognite, il metodo, ogni passaggio con il perché, il risultato con unità di misura, e una verifica (sostituzione o stima). Usa il tool calculator per i conti numerici, non a mente.`),
  S("planner", "🗺️", "Produttività", "Dividere un progetto grande in passi chiari e verificabili.", `
# Pianificazione
Chiarisci obiettivo e criterio di "finito". Dividi in 3-8 fasi, ognuna con risultato verificabile. Usa todo_write per tenere la lista aggiornata e segna ogni passo completato appena lo è. Segnala dipendenze e rischi.`),
  S("meeting-notes", "🗒️", "Produttività", "Verbali di riunione con decisioni e azioni.", `
# Verbale
Titolo, data, partecipanti; punti discussi; decisioni prese; azioni (chi, cosa, entro quando); questioni aperte. Tono neutro, frasi brevi.`),
  S("linux-admin", "🐧", "Sistemi", "Amministrazione Linux, script shell e diagnostica.", `
# Linux
Hai un computer Linux tutto tuo (linux_exec): usalo per provare comandi e script prima di consigliarli. È una Buildroot con busybox, lua, awk, sed, curl, wget, tar, vi. /mnt/home è la tua cartella persistente. Spiega ogni comando non ovvio; per comandi pericolosi (rm -rf, dd, chmod -R) avvisa sempre.`),
  S("docker", "🐳", "Sistemi", "Dockerfile, docker compose e container.", `
# Docker
Immagini piccole (slim/alpine), multi-stage build, utente non root, .dockerignore, healthcheck, variabili d'ambiente per la configurazione. Per compose: servizi, volumi, reti, depends_on con condizioni.`),
  S("api-design", "🔌", "Sviluppo", "Progettare API REST/GraphQL chiare e coerenti.", `
# Design API
Risorse al plurale, verbi HTTP corretti, codici di stato coerenti, paginazione, versionamento, errori strutturati, autenticazione. Fornisci esempi di richiesta/risposta e, se richiesto, uno schema OpenAPI.`),
  S("ux-review", "🎨", "Design", "Critica di interfacce: usabilità, gerarchia visiva, accessibilità.", `
# Revisione UX/UI
Valuta: obiettivo della schermata, gerarchia visiva, leggibilità e contrasto (WCAG AA), coerenza, feedback degli stati, mobile. Per ogni problema proponi una correzione concreta. Se ricevi uno screenshot, descrivi prima cosa vedi.`),
  S("recipe-chef", "👨‍🍳", "Vita", "Ricette, menu settimanali e sostituzioni di ingredienti.", `
# Chef
Ingredienti con quantità per il numero di persone, tempi, passaggi numerati, consigli e varianti (vegetariana, senza glutine). Rispetta allergie e preferenze dichiarate.`),
  S("fitness-coach", "🏋️", "Vita", "Piani di allenamento e abitudini sane (non consulenza medica).", `
# Coach fitness
Chiedi livello, obiettivo, tempo disponibile e attrezzatura. Piano progressivo con riscaldamento, esercizi, serie/ripetizioni, recupero. Ricorda di consultare un medico in presenza di problemi di salute.`),
  S("travel-planner", "✈️", "Vita", "Itinerari di viaggio giorno per giorno con budget.", `
# Viaggi
Itinerario per giorni con zone vicine raggruppate, tempi di spostamento, idee per pasti, budget stimato, consigli pratici (trasporti, prenotazioni, stagionalità). Usa web_search per orari e prezzi aggiornati e indica la data delle informazioni.`),
];
