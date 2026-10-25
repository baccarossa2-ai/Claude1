// Connectors that can be switched on with one click. The first group answered
// `initialize` with no credentials when this catalog was written; the second
// needs a token the user pastes in; the third are local stdio servers (desktop,
// need Node.js / Python on the machine).
export const CONNECTOR_CATALOG = [
  { id: "context7", name: "Context7", icon: "📚", category: "Sviluppo", transport: "http", url: "https://mcp.context7.com/mcp", auth: "none", description: "Documentazione aggiornata di migliaia di librerie e framework, sempre all'ultima versione." },
  { id: "deepwiki", name: "DeepWiki", icon: "🧭", category: "Sviluppo", transport: "http", url: "https://mcp.deepwiki.com/mcp", auth: "none", description: "Domande e risposte su qualsiasi repository GitHub pubblico." },
  { id: "mslearn", name: "Microsoft Learn", icon: "🪟", category: "Documentazione", transport: "http", url: "https://learn.microsoft.com/api/mcp", auth: "none", description: "Documentazione ufficiale Microsoft: Azure, .NET, Windows, Office, PowerShell." },
  { id: "cloudflare-docs", name: "Cloudflare Docs", icon: "🟠", category: "Documentazione", transport: "http", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none", description: "Ricerca nella documentazione Cloudflare (Workers, Pages, R2, D1…)." },
  { id: "aws-knowledge", name: "AWS Knowledge", icon: "☁️", category: "Documentazione", transport: "http", url: "https://knowledge-mcp.global.api.aws", auth: "none", description: "Documentazione, best practice e annunci di Amazon Web Services." },
  { id: "astro-docs", name: "Astro Docs", icon: "🚀", category: "Documentazione", transport: "http", url: "https://mcp.docs.astro.build/mcp", auth: "none", description: "Documentazione del framework web Astro." },
  { id: "gitmcp", name: "GitMCP Docs", icon: "🐙", category: "Sviluppo", transport: "http", url: "https://gitmcp.io/docs", auth: "none", description: "Legge documentazione e codice di qualunque progetto GitHub." },
  { id: "huggingface", name: "Hugging Face", icon: "🤗", category: "AI", transport: "http", url: "https://huggingface.co/mcp", auth: "optional", tokenHint: "hf_… (facoltativo)", description: "Cerca modelli, dataset, Spaces e paper su Hugging Face." },
  { id: "exa", name: "Exa Search", icon: "🔎", category: "Ricerca", transport: "http", url: "https://mcp.exa.ai/mcp", auth: "none", description: "Ricerca web neurale e lettura di pagine, pensata per gli agenti AI." },

  { id: "github", name: "GitHub", icon: "🐱", category: "Sviluppo", transport: "http", url: "https://api.githubcopilot.com/mcp/", auth: "token", tokenHint: "Personal Access Token GitHub (ghp_…)", description: "Repository, issue, pull request, Actions e codice su GitHub." },
  { id: "stripe", name: "Stripe", icon: "💳", category: "Business", transport: "http", url: "https://mcp.stripe.com", auth: "token", tokenHint: "Chiave segreta Stripe (sk_…/rk_…)", description: "Clienti, pagamenti, abbonamenti e fatture Stripe." },
  { id: "notion", name: "Notion", icon: "📝", category: "Produttività", transport: "http", url: "https://mcp.notion.com/mcp", auth: "token", tokenHint: "Token integrazione Notion", description: "Pagine, database e note del tuo spazio Notion." },
  { id: "linear", name: "Linear", icon: "📐", category: "Produttività", transport: "http", url: "https://mcp.linear.app/mcp", auth: "token", tokenHint: "API key Linear", description: "Issue, progetti e cicli di Linear." },
  { id: "sentry", name: "Sentry", icon: "🛡️", category: "Sviluppo", transport: "http", url: "https://mcp.sentry.dev/mcp", auth: "token", tokenHint: "Auth token Sentry", description: "Errori, issue e performance delle tue app su Sentry." },
  { id: "supabase", name: "Supabase", icon: "⚡", category: "Database", transport: "http", url: "https://mcp.supabase.com/mcp", auth: "token", tokenHint: "Personal access token Supabase", description: "Database Postgres, tabelle, SQL ed edge functions Supabase." },

  { id: "fs-local", name: "Filesystem (locale)", icon: "🗂️", category: "Locale", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "{workspace}"], auth: "none", desktopOnly: true, description: "Server MCP ufficiale per leggere e scrivere file nella cartella di lavoro (richiede Node.js)." },
  { id: "memory-local", name: "Memory Graph (locale)", icon: "🧠", category: "Locale", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], auth: "none", desktopOnly: true, description: "Memoria a grafo di conoscenza persistente (richiede Node.js)." },
  { id: "sequential-local", name: "Sequential Thinking (locale)", icon: "🪜", category: "Locale", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], auth: "none", desktopOnly: true, description: "Ragionamento passo-passo strutturato (richiede Node.js)." },
  { id: "playwright-local", name: "Playwright Browser (locale)", icon: "🎭", category: "Locale", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"], auth: "none", desktopOnly: true, description: "Controlla un vero browser: naviga, clicca, compila moduli (richiede Node.js)." },
  { id: "git-local", name: "Git (locale)", icon: "🌿", category: "Locale", transport: "stdio", command: "uvx", args: ["mcp-server-git", "--repository", "{workspace}"], auth: "none", desktopOnly: true, description: "Log, diff, commit e branch del repository nella cartella di lavoro (richiede uv/Python)." },
];

export const connectorById = (id) => CONNECTOR_CATALOG.find((c) => c.id === id);
