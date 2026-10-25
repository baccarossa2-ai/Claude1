// The plugin marketplace. A plugin bundles skills (built-in names or its own),
// slash commands (prompt templates; {input} is what follows the command),
// connectors from the catalog, and an optional system-prompt addition.
// Users can also install a plugin from a JSON file or URL (same shape).
export const PLUGIN_CATALOG = [
  {
    id: "dev-pro", name: "Sviluppatore Pro", icon: "💻", color: "#38bdf8", category: "Sviluppo", author: "Cloudy",
    description: "Revisione codice, debug, test, refactor, Git e documentazione aggiornata delle librerie.",
    skills: ["code-review", "debug", "write-tests", "refactor", "git-helper", "api-design"],
    connectors: ["context7", "deepwiki"],
    commands: [
      { name: "review", description: "Revisiona il codice indicato", prompt: "Usa la skill code-review e revisiona: {input}" },
      { name: "fix", description: "Trova e correggi un bug", prompt: "Usa la skill debug. Problema: {input}" },
      { name: "tests", description: "Scrivi i test per un file", prompt: "Usa la skill write-tests e scrivi test per: {input}. Poi eseguili." },
      { name: "explain", description: "Spiega il codice", prompt: "Spiega in modo semplice cosa fa questo codice e come è organizzato: {input}" },
    ],
  },
  {
    id: "web-studio", name: "Web Studio", icon: "🌐", color: "#a78bfa", category: "Sviluppo", author: "Cloudy",
    description: "Crea siti e web app con anteprima istantanea negli Artefatti.",
    skills: ["web-app", "ux-review", "seo"],
    connectors: ["context7", "astro-docs"],
    commands: [
      { name: "sito", description: "Crea un sito web completo", prompt: "Usa la skill web-app. Crea un sito in un unico file HTML (create_artifact kind html) per: {input}" },
      { name: "landing", description: "Landing page di prodotto", prompt: "Crea una landing page moderna e animata (artifact html) per: {input}" },
    ],
  },
  {
    id: "data-lab", name: "Data Lab", icon: "📊", color: "#34d399", category: "Dati", author: "Cloudy",
    description: "Analisi di CSV/JSON/Excel, SQL, regex e grafici.",
    skills: ["data-analysis", "sql-expert", "excel-formulas", "regex"],
    connectors: [],
    commands: [
      { name: "analizza", description: "Analizza i dati allegati", prompt: "Usa la skill data-analysis sui dati allegati o indicati: {input}" },
      { name: "sql", description: "Scrivi una query SQL", prompt: "Usa la skill sql-expert: {input}" },
      { name: "grafico", description: "Crea un grafico", prompt: "Crea un grafico chiaro come artifact html (Canvas/SVG, niente librerie esterne) di: {input}" },
    ],
  },
  {
    id: "writer", name: "Scrittore", icon: "✍️", color: "#f59e0b", category: "Scrittura", author: "Cloudy",
    description: "Articoli, email, riassunti, traduzioni e racconti.",
    skills: ["writing-pro", "email-writer", "summarizer", "translator", "storyteller"],
    connectors: [],
    commands: [
      { name: "email", description: "Scrivi un'email", prompt: "Usa la skill email-writer: {input}" },
      { name: "riassumi", description: "Riassumi testo o allegati", prompt: "Usa la skill summarizer: {input}" },
      { name: "traduci", description: "Traduci un testo", prompt: "Usa la skill translator. Traduci: {input}" },
      { name: "storia", description: "Scrivi un racconto", prompt: "Usa la skill storyteller: {input}" },
    ],
  },
  {
    id: "marketing", name: "Marketing", icon: "📣", color: "#f97316", category: "Business", author: "Cloudy",
    description: "Copy, SEO, social media e campagne.",
    skills: ["marketing-copy", "seo", "presentation"],
    connectors: ["exa"],
    commands: [
      { name: "post", description: "Post per i social", prompt: "Usa la skill marketing-copy. Scrivi post per Instagram, LinkedIn e X su: {input}" },
      { name: "slogan", description: "10 slogan", prompt: "Proponi 10 slogan memorabili per: {input}" },
    ],
  },
  {
    id: "business", name: "Business", icon: "💼", color: "#60a5fa", category: "Business", author: "Cloudy",
    description: "Business plan, presentazioni, verbali e analisi.",
    skills: ["business-plan", "presentation", "meeting-notes", "excel-formulas"],
    connectors: ["stripe"],
    commands: [
      { name: "pitch", description: "Pitch per investitori", prompt: "Usa la skill presentation. Prepara un pitch di 10 slide per: {input}" },
      { name: "verbale", description: "Verbale di riunione", prompt: "Usa la skill meeting-notes con questi appunti: {input}" },
    ],
  },
  {
    id: "studente", name: "Studente", icon: "🎓", color: "#8b5cf6", category: "Studio", author: "Cloudy",
    description: "Spiegazioni passo passo, esercizi, matematica e riassunti.",
    skills: ["teacher", "math-solver", "summarizer"],
    connectors: [],
    commands: [
      { name: "spiega", description: "Spiegami un argomento", prompt: "Usa la skill teacher. Spiegami: {input}" },
      { name: "quiz", description: "Quiz di verifica", prompt: "Crea un quiz di 10 domande a scelta multipla (con soluzioni alla fine) su: {input}" },
      { name: "risolvi", description: "Risolvi un esercizio", prompt: "Usa la skill math-solver: {input}" },
    ],
  },
  {
    id: "linux-ops", name: "Linux & DevOps", icon: "🐧", color: "#fbbf24", category: "Sistemi", author: "Cloudy",
    description: "Il computer Linux dell'IA, script shell, Docker e cloud.",
    skills: ["linux-admin", "docker"],
    connectors: ["aws-knowledge", "cloudflare-docs", "mslearn"],
    commands: [
      { name: "shell", description: "Esegui nel computer Linux", prompt: "Usa linux_exec per: {input}. Mostrami i comandi e il risultato." },
      { name: "dockerfile", description: "Crea un Dockerfile", prompt: "Usa la skill docker e crea Dockerfile e docker-compose per: {input}" },
    ],
  },
  {
    id: "security", name: "Sicurezza", icon: "🛡️", color: "#ef4444", category: "Sviluppo", author: "Cloudy",
    description: "Audit di sicurezza del proprio codice e segreti esposti.",
    skills: ["security-audit", "code-review"],
    connectors: [],
    commands: [{ name: "audit", description: "Audit di sicurezza", prompt: "Usa la skill security-audit sulla cartella di lavoro. Focus: {input}" }],
  },
  {
    id: "ricerca", name: "Ricerca Web", icon: "🔎", color: "#22d3ee", category: "Ricerca", author: "Cloudy",
    description: "Ricerche approfondite con fonti, riassunti e confronto.",
    skills: ["summarizer"],
    connectors: ["exa", "huggingface"],
    systemPrompt: "Quando fai ricerche cita sempre le fonti con link e indica la data delle informazioni.",
    commands: [
      { name: "cerca", description: "Ricerca con fonti", prompt: "Fai una ricerca approfondita (web_search + web_fetch su più fonti) e rispondi con fonti citate: {input}" },
      { name: "confronta", description: "Confronta prodotti/opzioni", prompt: "Ricerca e confronta in una tabella pro/contro/prezzo: {input}" },
    ],
  },
  {
    id: "produttivita", name: "Produttività", icon: "✅", color: "#10b981", category: "Produttività", author: "Cloudy",
    description: "Piani, liste di cose da fare, verbali e Notion/Linear.",
    skills: ["planner", "meeting-notes"],
    connectors: ["notion", "linear"],
    commands: [
      { name: "piano", description: "Piano di progetto", prompt: "Usa la skill planner (con todo_write) per: {input}" },
      { name: "settimana", description: "Organizza la settimana", prompt: "Organizza la mia settimana in blocchi orari realistici partendo da questi impegni: {input}" },
    ],
  },
  {
    id: "designer", name: "Designer", icon: "🎨", color: "#ec4899", category: "Design", author: "Cloudy",
    description: "Revisione UX, palette, mockup HTML e immagini generate.",
    skills: ["ux-review", "web-app"],
    connectors: [],
    commands: [
      { name: "mockup", description: "Mockup di un'interfaccia", prompt: "Crea un mockup interattivo (artifact html, design curato e animato) di: {input}" },
      { name: "immagine", description: "Genera un'immagine", prompt: "Genera un'immagine con generate_image: {input}" },
      { name: "palette", description: "Palette di colori", prompt: "Proponi 3 palette di colori con codici HEX e un'anteprima (artifact html) per: {input}" },
    ],
  },
  {
    id: "github-pro", name: "GitHub", icon: "🐙", color: "#e5e7eb", category: "Sviluppo", author: "Cloudy",
    description: "Repository, issue e PR tramite il connettore GitHub.",
    skills: ["git-helper", "code-review"],
    connectors: ["github", "deepwiki", "gitmcp"],
    commands: [{ name: "repo", description: "Analizza un repository GitHub", prompt: "Analizza il repository GitHub (usa deepwiki/gitmcp): {input}" }],
  },
  {
    id: "ai-research", name: "AI & ML", icon: "🤖", color: "#fcd34d", category: "AI", author: "Cloudy",
    description: "Modelli, dataset e paper da Hugging Face.",
    skills: ["teacher", "python-script"],
    connectors: ["huggingface"],
    commands: [{ name: "modello", description: "Trova un modello AI", prompt: "Cerca su Hugging Face il modello migliore per: {input}. Confronta i primi 3." }],
  },
  {
    id: "cucina", name: "Chef", icon: "👨‍🍳", color: "#fb923c", category: "Vita", author: "Cloudy",
    description: "Ricette, menu settimanali e lista della spesa.",
    skills: ["recipe-chef"],
    connectors: [],
    commands: [
      { name: "ricetta", description: "Una ricetta", prompt: "Usa la skill recipe-chef: {input}" },
      { name: "menu", description: "Menu settimanale + spesa", prompt: "Crea un menu settimanale equilibrato con lista della spesa per: {input}" },
    ],
  },
  {
    id: "viaggi", name: "Viaggi", icon: "✈️", color: "#38bdf8", category: "Vita", author: "Cloudy",
    description: "Itinerari giorno per giorno con budget.",
    skills: ["travel-planner"],
    connectors: [],
    commands: [{ name: "viaggio", description: "Pianifica un viaggio", prompt: "Usa la skill travel-planner: {input}" }],
  },
  {
    id: "fitness", name: "Fitness", icon: "🏋️", color: "#22c55e", category: "Vita", author: "Cloudy",
    description: "Piani di allenamento e abitudini.",
    skills: ["fitness-coach"],
    connectors: [],
    commands: [{ name: "allenamento", description: "Piano di allenamento", prompt: "Usa la skill fitness-coach: {input}" }],
  },
  {
    id: "python-lab", name: "Python Lab", icon: "🐍", color: "#3b82f6", category: "Sviluppo", author: "Cloudy",
    description: "Script Python, automazioni e piccoli tool.",
    skills: ["python-script", "write-tests", "debug"],
    connectors: ["context7"],
    commands: [{ name: "script", description: "Crea uno script", prompt: "Usa la skill python-script e crea uno script per: {input}" }],
  },
  {
    id: "docs-microsoft", name: "Microsoft & Windows", icon: "🪟", color: "#0ea5e9", category: "Sistemi", author: "Cloudy",
    description: "PowerShell, Windows, Office e Azure con la documentazione ufficiale.",
    skills: ["linux-admin"],
    connectors: ["mslearn"],
    commands: [{ name: "powershell", description: "Script PowerShell", prompt: "Scrivi uno script PowerShell commentato (verifica sulla documentazione Microsoft Learn) per: {input}" }],
  },
  {
    id: "browser-auto", name: "Automazione Browser", icon: "🎭", color: "#84cc16", category: "Locale", author: "Cloudy",
    description: "L'IA controlla un vero browser (desktop, richiede Node.js).",
    skills: [],
    connectors: ["playwright-local"],
    commands: [{ name: "naviga", description: "Usa il browser", prompt: "Con gli strumenti del browser Playwright: {input}" }],
  },
];

export const pluginById = (id) => PLUGIN_CATALOG.find((p) => p.id === id);

/** Validate a user-supplied plugin manifest. Throws with a readable message. */
export function validatePlugin(p) {
  if (!p || typeof p !== "object") throw new Error("Il plugin deve essere un oggetto JSON");
  if (!p.id || !/^[a-z0-9][a-z0-9-_]{1,40}$/i.test(p.id)) throw new Error('Campo "id" mancante o non valido');
  if (!p.name) throw new Error('Campo "name" mancante');
  for (const c of p.commands || []) if (!c.name || !c.prompt) throw new Error("Ogni comando richiede name e prompt");
  for (const s of p.skills || []) if (typeof s !== "string" && (!s.name || !s.content)) throw new Error("Ogni skill richiede name e content");
  return { icon: "🧩", color: "#9aa0a8", category: "Personalizzati", description: "", skills: [], commands: [], connectors: [], ...p, custom: true };
}
