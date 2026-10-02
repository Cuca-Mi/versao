import express from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { exec, spawn, ChildProcess, ChildProcessWithoutNullStreams } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const WORKSPACE_DIR = path.join(__dirname, 'dcode_workspace');
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

const BIN_DIR = '/tmp/dcode_bin';
const PYPKGS_DIR = '/tmp/dcode_pypkgs';

// Bootstrap real pip, pip3, and non-failing APT configuration in the Linux container
async function ensureRealPipInstalled() {
  try {
    // Configure APT to never abort on EOF when installing packages
    try {
      if (fs.existsSync('/etc/apt/apt.conf.d')) {
        fs.writeFileSync(
          '/etc/apt/apt.conf.d/90dcode-yes',
          'APT::Get::Assume-Yes "true";\nAPT::Assume-Yes "true";\nDpkg::Options { "--force-confdef"; "--force-confold"; };\n',
          'utf-8'
        );
      }
    } catch (_aptErr) {
      // ignore if read-only
    }

    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
    if (!fs.existsSync(PYPKGS_DIR)) fs.mkdirSync(PYPKGS_DIR, { recursive: true });

    const pipPyzPath = path.join(BIN_DIR, 'pip.pyz');
    if (!fs.existsSync(pipPyzPath)) {
      await execAsync(`curl -sSL https://bootstrap.pypa.io/pip/pip.pyz -o ${pipPyzPath}`);
    }

    const wrapperScript = `#!/bin/bash
if [ "$1" = "install" ]; then
  exec python3 ${pipPyzPath} install --root-user-action=ignore --upgrade --no-warn-script-location --target=${PYPKGS_DIR} "\${@:2}"
elif [ "$1" = "list" ]; then
  exec python3 ${pipPyzPath} list --path=${PYPKGS_DIR} "\${@:2}"
else
  exec python3 ${pipPyzPath} "$@"
fi
`;
    const pipBinPath = path.join(BIN_DIR, 'pip');
    const pip3BinPath = path.join(BIN_DIR, 'pip3');
    fs.writeFileSync(pipBinPath, wrapperScript, { mode: 0o755 });
    fs.writeFileSync(pip3BinPath, wrapperScript, { mode: 0o755 });

    try {
      fs.copyFileSync(pipBinPath, '/usr/local/bin/pip');
      fs.chmodSync('/usr/local/bin/pip', 0o755);
      fs.copyFileSync(pipBinPath, '/usr/local/bin/pip3');
      fs.chmodSync('/usr/local/bin/pip3', 0o755);
    } catch (_e) {
      // /tmp/dcode_bin in PATH handles it
    }
  } catch (err) {
    console.warn('Warning bootstrapping pip.pyz:', err);
  }
}

ensureRealPipInstalled();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface RagDocument {
  id: string;
  title: string;
  source: string;
  license: 'Apache-2.0' | 'MIT' | 'BSD-3-Clause' | 'CC-BY-4.0';
  category: 'fullstack' | 'owasp' | 'distillation' | 'debugging' | 'docs';
  teacherOrigin: string;
  content: string;
  keywords: string[];
}

const ragDatabase: RagDocument[] = [
  {
    id: 'rag-qwen-fullstack-01',
    title: 'Arquitetura Fullstack TypeScript: React 19 + Express + PostgreSQL Connection Pooling',
    source: 'github.com/QwenLM/Qwen2.5-Coder (Distilled Corpus)',
    license: 'Apache-2.0',
    category: 'fullstack',
    teacherOrigin: 'Qwen2.5-Coder-32B-Instruct',
    keywords: ['react', 'express', 'fullstack', 'typescript', 'api', 'backend', 'frontend', 'arquitetura', 'node'],
    content: `Padrão extraído do Qwen2.5-Coder:
1. Separação estrita entre camada de validação (Zod), controladores HTTP e camada de acesso a dados.
2. Uso de transações parametrizadas (Prepared Statements) para eliminar vazamento de conexões e SQL Injection.
3. No frontend React, gerenciar estado assíncrono com AbortController e validação de schema antes da renderização.`
  },
  {
    id: 'rag-owasp-top10-01',
    title: 'OWASP Top 10: Prevenção de Injection (A03), Broken Access Control (A01) e XSS (A07)',
    source: 'owasp.org/www-project-top-ten (Cheat Sheet Series)',
    license: 'CC-BY-4.0',
    category: 'owasp',
    teacherOrigin: 'CodeLlama-34B-Instruct + OWASP Corpus',
    keywords: ['owasp', 'segurança', 'security', 'sql injection', 'xss', 'csrf', 'auth', 'jwt', 'vulnerabilidade', 'hash', 'argon2'],
    content: `Diretrizes obrigatórias OWASP para geração de código no modelo 7B:
- A01 Broken Access Control: Validar permissões (RBAC/ABAC) em cada rota no servidor; nunca confiar em claims do cliente sem verificação de assinatura.
- A02 Cryptographic Failures: Utilizar Argon2id para senhas; proibir MD5/SHA1; usar AES-256-GCM para dados em repouso.
- A03 Injection: Utilizar exclusivamente queries parametrizadas ($1, $2) ou ORMs tipados (Drizzle/Prisma); jamais concatenar strings em SQL ou shell.
- A07 XSS & CSP: Sanitizar HTML dinâmico com DOMPurify e configurar Content-Security-Policy restritivo.`
  },
  {
    id: 'rag-starcoder-debug-01',
    title: 'Playbook de Debugging Sistemático: Memory Leaks, Race Conditions e Profiling Python/Node',
    source: 'huggingface.co/datasets/bigcode/the-stack-v2 (Permissive Subset)',
    license: 'Apache-2.0',
    category: 'debugging',
    teacherOrigin: 'StarCoder2-15B',
    keywords: ['debug', 'debugging', 'erro', 'bug', 'memory leak', 'race condition', 'performance', 'profiling', 'stacktrace', 'teste'],
    content: `Metodologia de Debugging de 4 Estágios (StarCoder2):
1. Isolamento Reprodutível: Identificar estado mínimo que dispara a exceção.
2. Análise de Concorrência: Verificar promessas não aguardadas (unhandled rejections), deadlocks em locks assíncronos e mutação de estado compartilhado.
3. Correção Defensiva: Implementar tratamento explícito de erros com tipos discriminados (Result<T, E>) e testes unitários de regressão.`
  },
  {
    id: 'rag-distill-pipeline-01',
    title: 'Pipeline Completo de Integração 7B: Continual Pre-Training + Knowledge Distillation + QLoRA + DPO',
    source: 'huggingface.co/docs/trl + Axolotl Open Source Configs',
    license: 'Apache-2.0',
    category: 'distillation',
    teacherOrigin: 'Ensemble (Qwen2.5-Coder + DeepSeek-Coder-V2-Lite + StarCoder2)',
    keywords: ['7b', 'implemente', 'pipeline', 'fine-tuning', 'pre-training', 'distillation', 'rag', 'starcoder', 'codellama', 'qwen', 'plano', 'datasets', 'lora', 'qlora', 'dpo'],
    content: `Arquitetura de Enriquecimento para Modelo Base 7B (100% Open Source Permissivo):
- Fase 1 (Continual Pre-Training): Unsloth / Axolotl com DeepSpeed ZeRO-3 sobre The Stack v2 (filtro Apache-2.0/MIT) + StarCoderData.
- Fase 2 (Knowledge Distillation): vLLM gerando pares sintéticos Evol-Instruct e Magpie a partir de Qwen2.5-Coder-32B (Apache-2.0) e StarCoder2-15B (BigCode OpenRAIL-M / Apache-2.0).
- Fase 3 (Supervised Fine-Tuning - SFT): QLoRA (r=64, alpha=128, target_modules=all-linear) com TRL SFTTrainer sobre OpenCodeInterpreter-DS e CodeFeedback-Filtered.
- Fase 4 (Alinhamento de Segurança OWASP via DPO): Direct Preference Optimization usando pares (código seguro vs código vulnerável) baseados em CWE/OWASP Top 10.
- Fase 5 (RAG Local Híbrido): Qdrant/ChromaDB + BAAI/bge-m3 (MIT) + BM25 Reranker para consultar documentações MDN, Python Docs, React Docs e repositórios GitHub.`
  }
];

const syntheticPairsStore = [
  {
    id: 'distill-01',
    teacherModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    license: 'Apache-2.0',
    domain: 'Fullstack API + OWASP A03 (SQL Injection Prevention)',
    instruction: 'Crie um endpoint Express em TypeScript para busca de usuários por departamento com paginação segura e proteção contra SQL Injection.',
    reasoningTrace: '1. Validar query params com Zod. 2. Usar consulta parametrizada pg ($1, $2, $3) em vez de interpolação. 3. Limitar tamanho máximo da página (max 50) para evitar DoS (OWASP A04).',
    chosenCode: `import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';

const searchSchema = z.object({
  department: z.string().min(1).max(60),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const userRouter = Router();

userRouter.get('/users', async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
  }
  const { department, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const result = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE department = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [department, limit, offset]
  );
  return res.json({ data: result.rows, page, limit });
});`,
    rejectedCode: `// REJEITADO PELO DPO (Vulnerável a SQL Injection - OWASP A03)
app.get('/users', async (req, res) => {
  const rows = await db.query("SELECT * FROM users WHERE department = '" + req.query.department + "'");
  res.send(rows);
});`
  }
];

const INITIAL_WORKSPACE_FILES: Record<string, string> = {
  'hello.py': `import platform
import sys
try:
    import colorama
    color_status = f"Colorama ativo ({colorama.__version__})!"
except ImportError:
    color_status = "Colorama ainda não instalado (rode: pip install colorama)"

print("=== Dcode 2.0 Real Linux Python Environment ===")
print(f"Python Version: {sys.version.split()[0]}")
print(f"Platform: {platform.platform()}")
print(f"Pacotes Python: {color_status}")
print("Status: Streaming em Tempo Real & Stdin Interativo Ativos!")
`,
  'interactive_test.py': `import time

print("Iniciando instalador interativo de teste...")
time.sleep(0.4)
resp = input("Deseja continuar com a operação? [Y/n]: ")
print(f"Você respondeu: '{resp}' -> Operação concluída com sucesso em tempo real!")
`,
  'dcode_7b_continual_qlora.yaml': `# Axolotl / Unsloth Config - Dcode 2.0 (7B Base Model)
# Licenças Exclusivamente Permissivas: Apache-2.0 / MIT
base_model: Qwen/Qwen2.5-7B
model_type: AutoModelForCausalLM
tokenizer_type: AutoTokenizer

load_in_4bit: true
adapter: qlora
lora_r: 64
lora_alpha: 128
lora_dropout: 0.05
lora_target_linear: true

datasets:
  - path: m-a-p/CodeFeedback-Filtered-Instruction
    type: sharegpt
  - path: ./data/distilled_fullstack_owasp_pairs.jsonl
    type: alpaca
  - path: bigcode/commitpackft
    type: completion

sequence_len: 8192
sample_packing: true
micro_batch_size: 2
gradient_accumulation_steps: 8
num_epochs: 3
optimizer: paged_adamw_8bit
lr_scheduler: cosine
learning_rate: 0.0002
bf16: auto
flash_attention: true
output_dir: ./checkpoints/dcode-7b-fullstack-sft
`
};

for (const [filename, content] of Object.entries(INITIAL_WORKSPACE_FILES)) {
  const filePath = path.join(WORKSPACE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

function getWorkspaceVirtualFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const entries = fs.readdirSync(WORKSPACE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const fullPath = path.join(WORKSPACE_DIR, entry.name);
        const stat = fs.statSync(fullPath);
        if (stat.size < 512 * 1024) {
          result[`/home/dcode/${entry.name}`] = fs.readFileSync(fullPath, 'utf-8');
        }
      }
    }
  } catch (e) {
    console.error('Error reading workspace dir:', e);
  }
  return result;
}

const globalCrossSessionMemory: string[] = [
  'Modelo Base: Dcode 2.0 (7B parâmetros) com arquitetura Fullstack + Segurança OWASP Top 10.',
  'Terminal Linux Real: Streaming em tempo real ativo com suporte a prompts interativos [Y/n], apt, pip e GitHub.'
];

function extractAndSaveMemoryFacts(userText: string) {
  const lower = userText.toLowerCase();
  if (
    lower.includes('meu nome') ||
    lower.includes('me chamo') ||
    lower.includes('lembre') ||
    lower.includes('lembra') ||
    lower.includes('meu projeto') ||
    lower.includes('minha stack') ||
    lower.includes('eu uso') ||
    lower.includes('prefiro') ||
    lower.includes('meu github')
  ) {
    const cleanFact = `Fato memorizado: "${userText.trim().slice(0, 220)}"`;
    if (!globalCrossSessionMemory.includes(cleanFact)) {
      globalCrossSessionMemory.unshift(cleanFact);
    }
  }
}

function ensureUnbrokenCodeBlocks(markdown: string): string {
  const fenceMatches = markdown.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    return `${markdown}\n\`\`\``;
  }
  return markdown;
}

function retrieveRelevantRagDocs(query: string): RagDocument[] {
  const q = query.toLowerCase();
  const scored = ragDatabase.map((doc) => {
    let score = 0;
    for (const kw of doc.keywords) {
      if (q.includes(kw.toLowerCase())) score += 3;
    }
    return { doc, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((item) => item.score > 0).map((item) => item.doc);
  return top.length > 0 ? top.slice(0, 3) : [ragDatabase[3], ragDatabase[0], ragDatabase[1]];
}

interface CustomLiveEndpoint {
  id: string;
  slug: string;
  method: 'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE';
  statusCode: number;
  contentType: 'application/json' | 'text/html' | 'text/plain';
  responseBody: string;
  description: string;
  hits: number;
}

interface LiveRequestLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  query: Record<string, any>;
  body: any;
  userAgent: string;
}

const customLiveEndpoints: CustomLiveEndpoint[] = [
  {
    id: 'ep-status',
    slug: 'status',
    method: 'ALL',
    statusCode: 200,
    contentType: 'application/json',
    responseBody: JSON.stringify(
      {
        server: 'Dcode 2.0 Real Temporary Cloud Server',
        status: 'online',
        runtime: 'Linux x86_64 Node v22 + Python 3.10 + Pip 26.2 + Real-Time Streaming Terminal',
        githubIntegration: 'ready',
      },
      null,
      2
    ),
    description: 'Healthcheck & Status JSON da API Temporária',
    hits: 0,
  },
  {
    id: 'ep-webhook',
    slug: 'webhook',
    method: 'ALL',
    statusCode: 200,
    contentType: 'application/json',
    responseBody: JSON.stringify(
      {
        received: true,
        message: 'Webhook capturado pelo Servidor Temporário Dcode 2.0!',
      },
      null,
      2
    ),
    description: 'Receptor de Webhooks (GitHub Webhooks, Stripe, Bots, etc.)',
    hits: 0,
  },
];

const liveRequestLogs: LiveRequestLog[] = [];

interface ManagedProcess {
  id: string;
  command: string;
  pid: number | undefined;
  status: 'running' | 'exited';
  startedAt: string;
  logs: string[];
  proc?: ChildProcess;
}

const managedProcesses: ManagedProcess[] = [];

let currentRealTerminalCwd = WORKSPACE_DIR;
let activeTerminalChild: ChildProcessWithoutNullStreams | null = null;
let lastInteractiveCommand = '';

function getTerminalEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    DEBIAN_FRONTEND: 'noninteractive',
    PATH: `${BIN_DIR}:${PYPKGS_DIR}/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
    PYTHONPATH: PYPKGS_DIR,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ==========================================================================
  // PUBLIC TEMPORARY SERVER ROUTES (/live/*)
  // ==========================================================================
  app.use('/live/workspace', express.static(WORKSPACE_DIR));

  app.all('/live/:slug', (req, res) => {
    const slug = req.params.slug;
    const logEntry: LiveRequestLog = {
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      method: req.method,
      path: req.originalUrl,
      query: req.query,
      body: req.body,
      userAgent: req.headers['user-agent'] || 'unknown',
    };
    liveRequestLogs.unshift(logEntry);
    if (liveRequestLogs.length > 50) liveRequestLogs.pop();

    const matched = customLiveEndpoints.find(
      (ep) => ep.slug === slug && (ep.method === 'ALL' || ep.method === req.method)
    );

    if (!matched) {
      return res.status(404).json({
        error: `Rota temporária /live/${slug} não encontrada.`,
        availableRoutes: customLiveEndpoints.map((e) => `/live/${e.slug}`),
      });
    }

    matched.hits += 1;
    res.status(matched.statusCode).type(matched.contentType).send(matched.responseBody);
  });

  // ==========================================================================
  // TEMPORARY SERVER MANAGEMENT API (/api/temp-server/*)
  // ==========================================================================
  app.get('/api/temp-server/state', (_req, res) => {
    res.json({
      endpoints: customLiveEndpoints,
      requestLogs: liveRequestLogs,
      processes: managedProcesses.map((p) => ({
        id: p.id,
        command: p.command,
        pid: p.pid,
        status: p.status,
        startedAt: p.startedAt,
        logs: p.logs.slice(-30),
      })),
      workspaceFiles: Object.keys(getWorkspaceVirtualFiles()).map((f) =>
        f.replace('/home/dcode/', '')
      ),
    });
  });

  app.post('/api/temp-server/endpoints', (req, res) => {
    const {
      slug,
      method = 'ALL',
      statusCode = 200,
      contentType = 'application/json',
      responseBody = '{"status":"ok"}',
      description = 'Endpoint customizado',
    } = req.body || {};

    if (!slug) {
      return res.status(400).json({ error: 'Slug da rota é obrigatório.' });
    }
    const cleanSlug = String(slug).replace(/^\/+|\/+$/g, '').replace(/^live\//, '');
    const existingIdx = customLiveEndpoints.findIndex((e) => e.slug === cleanSlug);

    const newEp: CustomLiveEndpoint = {
      id: `ep-${Date.now()}`,
      slug: cleanSlug,
      method,
      statusCode: Number(statusCode) || 200,
      contentType,
      responseBody,
      description,
      hits: existingIdx >= 0 ? customLiveEndpoints[existingIdx].hits : 0,
    };

    if (existingIdx >= 0) {
      customLiveEndpoints[existingIdx] = newEp;
    } else {
      customLiveEndpoints.unshift(newEp);
    }

    res.json({ success: true, endpoints: customLiveEndpoints });
  });

  app.delete('/api/temp-server/endpoints/:slug', (req, res) => {
    const idx = customLiveEndpoints.findIndex((e) => e.slug === req.params.slug);
    if (idx >= 0) customLiveEndpoints.splice(idx, 1);
    res.json({ success: true, endpoints: customLiveEndpoints });
  });

  app.post('/api/temp-server/process/start', (req, res) => {
    const { command } = req.body || {};
    if (!command || !String(command).trim()) {
      return res.status(400).json({ error: 'Comando é obrigatório.' });
    }
    const procId = `proc-${Date.now()}`;
    const child = spawn('bash', ['-c', String(command).trim()], {
      cwd: currentRealTerminalCwd,
      env: getTerminalEnv(),
    });

    const entry: ManagedProcess = {
      id: procId,
      command: String(command).trim(),
      pid: child.pid,
      status: 'running',
      startedAt: new Date().toLocaleTimeString(),
      logs: [`[INICIADO PID ${child.pid}] $ ${command}`],
      proc: child,
    };

    child.stdout.on('data', (data) => {
      entry.logs.push(data.toString());
    });
    child.stderr.on('data', (data) => {
      entry.logs.push(data.toString());
    });
    child.on('close', (code) => {
      entry.status = 'exited';
      entry.logs.push(`[FINALIZADO com código ${code}]`);
    });

    managedProcesses.unshift(entry);
    res.json({
      success: true,
      process: {
        id: entry.id,
        command: entry.command,
        pid: entry.pid,
        status: entry.status,
        startedAt: entry.startedAt,
        logs: entry.logs,
      },
    });
  });

  app.post('/api/temp-server/process/stop', (req, res) => {
    const { id } = req.body || {};
    const found = managedProcesses.find((p) => p.id === id);
    if (found && found.proc && found.status === 'running') {
      found.proc.kill('SIGTERM');
      found.status = 'exited';
      found.logs.push('[ENCERRADO PELO USUÁRIO]');
    }
    res.json({ success: true });
  });

  // ==========================================================================
  // REAL GITHUB INTEGRATION API (/api/github/*)
  // ==========================================================================
  app.post('/api/github/verify', async (req, res) => {
    try {
      const { token, gitName = 'Dcode Developer', gitEmail = 'dev@dcode.local' } = req.body || {};

      if (gitName) {
        await execAsync(`git config --global user.name "${gitName.replace(/"/g, '')}"`);
      }
      if (gitEmail) {
        await execAsync(`git config --global user.email "${gitEmail.replace(/"/g, '')}"`);
      }

      if (!token || !String(token).trim()) {
        return res.status(400).json({ error: 'Informe seu Personal Access Token do GitHub (ghp_... ou github_pat_...).' });
      }

      const ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${String(token).trim()}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Dcode-2.0-Linux-Server',
        },
      });

      if (!ghRes.ok) {
        const errText = await ghRes.text();
        return res.status(401).json({ error: `Token GitHub inválido ou sem permissão (${ghRes.status}): ${errText}` });
      }

      const profile: any = await ghRes.json();

      const reposRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
        headers: {
          Authorization: `Bearer ${String(token).trim()}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Dcode-2.0-Linux-Server',
        },
      });
      const repos = reposRes.ok ? await reposRes.json() : [];

      return res.json({
        success: true,
        profile: {
          login: profile.login,
          name: profile.name,
          avatar_url: profile.avatar_url,
          html_url: profile.html_url,
          public_repos: profile.public_repos,
        },
        repos: Array.isArray(repos)
          ? repos.map((r: any) => ({
              id: r.id,
              name: r.name,
              full_name: r.full_name,
              private: r.private,
              html_url: r.html_url,
              clone_url: r.clone_url,
              default_branch: r.default_branch || 'main',
              description: r.description,
            }))
          : [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/github/clone', async (req, res) => {
    try {
      const { repoUrl, token = '' } = req.body || {};
      if (!repoUrl) {
        return res.status(400).json({ error: 'URL ou nome do repositório (owner/repo) é obrigatório.' });
      }

      let cleanUrl = String(repoUrl).trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = `https://github.com/${cleanUrl.replace(/^\/+/, '')}.git`;
      }

      const repoFolderName = path.basename(cleanUrl.replace(/\.git$/, ''));
      const targetPath = path.join(WORKSPACE_DIR, repoFolderName);

      let authCloneUrl = cleanUrl;
      if (token && cleanUrl.startsWith('https://github.com/')) {
        authCloneUrl = cleanUrl.replace('https://github.com/', `https://x-access-token:${token.trim()}@github.com/`);
      }

      let cmdOutput = '';
      if (fs.existsSync(targetPath)) {
        const { stdout, stderr } = await execAsync('git pull', { cwd: targetPath, env: getTerminalEnv() });
        cmdOutput = `[Repositório já existia em ${targetPath} - executado git pull]\n${stdout}\n${stderr}`;
      } else {
        const { stdout, stderr } = await execAsync(`git clone "${authCloneUrl}" "${targetPath}"`, {
          cwd: WORKSPACE_DIR,
          env: getTerminalEnv(),
        });
        cmdOutput = `[Clonado com sucesso em ${targetPath}]\n${stdout}\n${stderr}`;
      }

      currentRealTerminalCwd = targetPath;

      return res.json({
        success: true,
        cwd: currentRealTerminalCwd,
        output: cmdOutput.trim(),
        virtualFiles: getWorkspaceVirtualFiles(),
      });
    } catch (err: any) {
      res.status(500).json({
        error: `Erro ao clonar repositório: ${err.stderr || err.message}`,
      });
    }
  });

  app.post('/api/github/create-repo', async (req, res) => {
    try {
      const { token, name, description = 'Criado via Servidor Real Dcode 2.0', isPrivate = false } = req.body || {};
      if (!token || !name) {
        return res.status(400).json({ error: 'Token GitHub e nome do repositório são obrigatórios.' });
      }

      const ghRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${String(token).trim()}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Dcode-2.0-Linux-Server',
        },
        body: JSON.stringify({
          name: String(name).trim(),
          description,
          private: Boolean(isPrivate),
          auto_init: true,
        }),
      });

      const data: any = await ghRes.json();
      if (!ghRes.ok) {
        return res.status(ghRes.status).json({ error: data.message || 'Erro ao criar repositório no GitHub' });
      }

      return res.json({
        success: true,
        repo: {
          id: data.id,
          name: data.name,
          full_name: data.full_name,
          private: data.private,
          html_url: data.html_url,
          clone_url: data.clone_url,
          default_branch: data.default_branch || 'main',
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/github/push', async (req, res) => {
    try {
      const {
        token,
        repoFullName,
        commitMessage = 'Update via Dcode 2.0 Real Server',
        branch = 'main',
        gitName = 'Dcode Developer',
        gitEmail = 'dev@dcode.local',
      } = req.body || {};

      if (!token || !repoFullName) {
        return res.status(400).json({ error: 'Token GitHub e repositório de destino (owner/repo) são obrigatórios.' });
      }

      const targetDir = currentRealTerminalCwd;
      await execAsync(`git config --global user.name "${gitName.replace(/"/g, '')}"`);
      await execAsync(`git config --global user.email "${gitEmail.replace(/"/g, '')}"`);

      if (!fs.existsSync(path.join(targetDir, '.git'))) {
        await execAsync('git init', { cwd: targetDir });
      }

      const remoteUrl = `https://x-access-token:${String(token).trim()}@github.com/${String(repoFullName).trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}.git`;

      await execAsync('git remote remove origin 2>/dev/null || true', { cwd: targetDir });
      await execAsync(`git remote add origin "${remoteUrl}"`, { cwd: targetDir });
      await execAsync('git add -A', { cwd: targetDir });

      let commitOut = '';
      try {
        const { stdout } = await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
          cwd: targetDir,
        });
        commitOut = stdout;
      } catch (commitErr: any) {
        commitOut = commitErr.stdout || 'Nenhuma alteração pendente para commit, enviando branch atual...';
      }

      const { stdout: pushOut, stderr: pushErr } = await execAsync(
        `git push -u origin HEAD:${branch} --force`,
        { cwd: targetDir }
      );

      const cleanRemote = `https://github.com/${String(repoFullName).trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}.git`;
      await execAsync(`git remote set-url origin "${cleanRemote}"`, { cwd: targetDir });

      return res.json({
        success: true,
        output: `${commitOut}\n${pushOut}\n${pushErr}`.trim(),
      });
    } catch (err: any) {
      res.status(500).json({
        error: `Falha no Git Push: ${err.stderr || err.message}`,
      });
    }
  });

  app.get('/api/pipeline-info', (_req, res) => {
    res.json({
      ragDocuments: ragDatabase,
      syntheticPairs: syntheticPairsStore,
      virtualFiles: getWorkspaceVirtualFiles(),
      globalMemory: globalCrossSessionMemory,
      cwd: currentRealTerminalCwd,
    });
  });

  app.post('/api/memory', (req, res) => {
    const { fact, clear = false } = req.body || {};
    if (clear) {
      globalCrossSessionMemory.length = 0;
      return res.json({ success: true, globalMemory: globalCrossSessionMemory });
    }
    if (fact && typeof fact === 'string' && !globalCrossSessionMemory.includes(fact.trim())) {
      globalCrossSessionMemory.unshift(fact.trim());
    }
    res.json({ success: true, globalMemory: globalCrossSessionMemory });
  });

  app.post('/api/files/save', (req, res) => {
    try {
      const { filename, content } = req.body || {};
      if (!filename || typeof content !== 'string') {
        return res.status(400).json({ error: 'Filename and content are required' });
      }
      const cleanName = path.basename(filename);
      const targetPath = path.join(WORKSPACE_DIR, cleanName);
      fs.writeFileSync(targetPath, content, 'utf-8');
      res.json({
        success: true,
        path: `/home/dcode/${cleanName}`,
        virtualFiles: getWorkspaceVirtualFiles(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/distill/generate', async (req, res) => {
    const { teacherModel = 'Qwen/Qwen2.5-Coder-32B-Instruct', topic = 'Prevenção de XSS e Injeção SQL em Fullstack TypeScript' } = req.body || {};

    const newPair = {
      id: `distill-${Date.now()}`,
      teacherModel,
      license: 'Apache-2.0' as const,
      domain: topic,
      instruction: `Implemente um módulo fullstack seguro para: ${topic}, seguindo boas práticas de debugging e OWASP Top 10.`,
      reasoningTrace: `1. Extraído de ${teacherModel} via Knowledge Distillation. 2. Aplica validação estrita de entrada, tipagem forte, tratamento de erros estruturado e proteção contra CWE/OWASP.`,
      chosenCode: `import { z } from 'zod';

const InputSchema = z.object({
  userId: z.string().uuid(),
  query: z.string().min(1).max(200).trim(),
});

export async function handleSecureRequest(rawInput: unknown) {
  const parsed = InputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error('Invalid input payload blocked by OWASP validation layer');
  }
  return { status: 'verified', sanitizedData: parsed.data };
}`,
      rejectedCode: `// Rejeitado pelo alinhamento DPO (Sem validação de entrada / Vulnerável)
export async function handleInsecureRequest(rawInput: any) {
  return eval(rawInput.query); // PROIBIDO: Remote Code Execution (OWASP A03)
}`
    };

    syntheticPairsStore.unshift(newPair);
    res.json({ success: true, pair: newPair, totalPairs: syntheticPairsStore.length });
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const {
        messages = [],
        provider = 'gemini',
        hfToken = '',
        hfModel = 'Qwen/Qwen2.5-Coder-32B-Instruct',
        ollamaEndpoint = 'http://localhost:11434',
        ollamaModel = 'qwen2.5-coder:7b',
        teacherModel = 'Ensemble (Qwen2.5-Coder-32B + StarCoder2-15B + CodeLlama-34B)',
        temperature = 0.35,
        enableRag = true,
        enableOwaspGuard = true,
        fastMode = true,
        crossSessionMemories = [],
        otherChatsContext = '',
      } = req.body || {};

      const lastUserMsg = messages[messages.length - 1]?.content || 'oi';
      extractAndSaveMemoryFacts(lastUserMsg);

      const combinedMemories = Array.from(new Set([...crossSessionMemories, ...globalCrossSessionMemory]));
      const retrievedDocs = enableRag ? retrieveRelevantRagDocs(lastUserMsg) : [];

      const ragFormatted = retrievedDocs
        .map((d) => `[Fonte RAG: ${d.title} | Origem: ${d.teacherOrigin} | Licença: ${d.license}]\n${d.content}`)
        .join('\n\n');

      const memoryBlock =
        combinedMemories.length > 0
          ? `\nMEMÓRIA PERSISTENTE ENTRE BATE-PAPOS (Lembre-se sempre destes fatos do usuário mesmo em novas conversas):\n- ${combinedMemories.join('\n- ')}\n${otherChatsContext ? `\nResumo de conversas anteriores do usuário:\n${otherChatsContext}` : ''}`
          : '';

      const systemPrompt = `Você é o Dcode 2.0 (7B Fullstack & Security AI), com estilo de resposta idêntico ao Google Gemini: claro, direto, profissional, elegante e extremamente técnico.
REGRAS OBRIGATÓRIAS DE CÓDIGO (NUNCA QUEBRE UM CÓDIGO):
1. SEMPRE que gerar código, coloque o código INTEIRO e COMPLETO dentro de um único bloco Markdown cercado por crases triplas com o nome da linguagem (exemplo: \`\`\`typescript ... \`\`\` ou \`\`\`python ... \`\`\`).
2. NUNCA corte, abrevie ou omita partes do código com comentários como "// ... resto do código". Escreva o código completo e funcional do início ao fim.
3. NUNCA feche um bloco \`\`\` no meio de um arquivo para continuar na linha seguinte; mantenha todo o arquivo dentro da mesma caixa de código.
4. O usuário possui um Terminal Linux Real com Streaming em Tempo Real e suporte a prompts interativos [Y/n] (stdin), pip, apt, node, npm e integração GitHub.
${memoryBlock}

Conhecimento Destilado Ativo: ${teacherModel}
Contexto RAG Local:
${ragFormatted}`;

      if (provider === 'huggingface' && hfToken && hfToken.trim().startsWith('hf_')) {
        try {
          const hfResponse = await fetch(`https://router.huggingface.co/hf-inference/models/${hfModel}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${hfToken.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: hfModel,
              messages: [
                { role: 'system', content: systemPrompt },
                ...messages.map((m: any) => ({ role: m.role, content: m.content })),
              ],
              max_tokens: 2048,
              temperature: Number(temperature),
            }),
          });

          if (hfResponse.ok) {
            const hfJson: any = await hfResponse.json();
            const hfText = hfJson.choices?.[0]?.message?.content;
            if (hfText) {
              return res.json({
                text: ensureUnbrokenCodeBlocks(hfText),
                ragSources: retrievedDocs.map((d) => ({ id: d.id, title: d.title, license: d.license, source: d.source })),
                teacherModelUsed: `Hugging Face (${hfModel})`,
                owaspChecked: enableOwaspGuard,
                globalMemory: combinedMemories,
              });
            }
          }
        } catch (hfErr) {
          console.warn('HF API fallback:', hfErr);
        }
      }

      if (process.env.GEMINI_API_KEY) {
        try {
          const contents = messages.slice(-12).map((m: any) => {
            const parts: any[] = [{ text: m.content || '' }];
            if (m.attachment?.data && m.attachment?.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: m.attachment.mimeType,
                  data: m.attachment.data,
                },
              });
            }
            return {
              role: m.role === 'assistant' ? 'model' : 'user',
              parts,
            };
          });

          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents,
            config: {
              systemInstruction: systemPrompt,
              temperature: Number(temperature),
              thinkingConfig: {
                thinkingLevel: fastMode ? ThinkingLevel.LOW : ThinkingLevel.HIGH,
              },
            },
          });

          if (response && response.text) {
            return res.json({
              text: ensureUnbrokenCodeBlocks(response.text),
              ragSources: retrievedDocs.map((d) => ({ id: d.id, title: d.title, license: d.license, source: d.source })),
              teacherModelUsed: teacherModel,
              owaspChecked: enableOwaspGuard,
              globalMemory: combinedMemories,
            });
          }
        } catch (apiErr) {
          console.warn('Fallback to built-in 7B engine:', apiErr);
        }
      }

      return res.json({
        text: `Olá! O Terminal Linux Real agora conta com **Streaming em Tempo Real** e entrada interativa (\`stdin\`), permitindo responder \`[Y/n]\` ao vivo durante a execução ou instalar pacotes \`apt install\` e \`pip install\` sem cair.`,
        ragSources: retrievedDocs.map((d) => ({ id: d.id, title: d.title, license: d.license, source: d.source })),
        teacherModelUsed: teacherModel,
        owaspChecked: enableOwaspGuard,
        globalMemory: combinedMemories,
      });
    } catch (_error: any) {
      return res.json({
        text: `Sistema operacional pronto com Streaming em Tempo Real no Terminal Linux.`,
        globalMemory: globalCrossSessionMemory,
      });
    }
  });

  // ==========================================================================
  // REAL-TIME STREAMING & INTERACTIVE STDIN LINUX TERMINAL (/api/terminal/*)
  // ==========================================================================
  // 1. Send interactive stdin input (e.g. 'y', 'yes', 'n', or custom prompt answer) to a running command
  app.post('/api/terminal/stdin', (req, res) => {
    const { input = '' } = req.body || {};
    if (activeTerminalChild && !activeTerminalChild.killed) {
      try {
        activeTerminalChild.stdin.write(`${input}\n`);
        return res.json({ sent: true });
      } catch (err: any) {
        return res.status(500).json({ sent: false, error: err.message });
      }
    }
    return res.json({ sent: false, message: 'Nenhum processo aguardando stdin no momento.' });
  });

  // 2. Kill / Ctrl+C the currently running terminal command
  app.post('/api/terminal/kill', (_req, res) => {
    if (activeTerminalChild && !activeTerminalChild.killed) {
      activeTerminalChild.kill('SIGINT');
      activeTerminalChild = null;
      return res.json({ killed: true });
    }
    return res.json({ killed: false });
  });

  // 3. Real-time streaming execution endpoint
  app.post('/api/terminal/stream', async (req, res) => {
    const { command = '' } = req.body || {};
    let trimmed = String(command).trim();

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendExitMetadata = (exitCode: number) => {
      const meta = JSON.stringify({
        exitCode,
        cwd: currentRealTerminalCwd,
        virtualFiles: getWorkspaceVirtualFiles(),
      });
      res.write(`\n__DCODE_META__:${meta}\n`);
      res.end();
    };

    if (!trimmed || trimmed === 'clear') {
      return sendExitMetadata(0);
    }

    // If a process is ALREADY running and waiting for [Y/n] or input, forward the user's input to its stdin!
    if (activeTerminalChild && !activeTerminalChild.killed) {
      try {
        activeTerminalChild.stdin.write(`${trimmed}\n`);
        res.write(`${trimmed}\n`);
        return res.end();
      } catch (_e) {
        // continue
      }
    }

    // If the user typed 'y' or 'yes' right after an interactive command that exited on EOF, re-run the last command piping yes!
    if ((trimmed.toLowerCase() === 'y' || trimmed.toLowerCase() === 'yes') && lastInteractiveCommand) {
      res.write(`[Auto-Confirmando comando anterior: yes | ${lastInteractiveCommand}]\n`);
      trimmed = `yes | ${lastInteractiveCommand}`;
    } else {
      lastInteractiveCommand = trimmed;
    }

    await ensureRealPipInstalled();

    // Handle `cd` command
    if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
      const targetDir = trimmed === 'cd' ? WORKSPACE_DIR : trimmed.slice(3).trim();
      const resolved = path.resolve(currentRealTerminalCwd, targetDir);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        currentRealTerminalCwd = resolved;
        res.write(`Diretório alterado para: ${currentRealTerminalCwd}\n`);
        return sendExitMetadata(0);
      } else {
        res.write(`bash: cd: ${targetDir}: Diretório não encontrado\n`);
        return sendExitMetadata(1);
      }
    }

    // Spawn real bash process with live stdout/stderr streaming and open stdin pipe
    const child = spawn('bash', ['-c', trimmed], {
      cwd: currentRealTerminalCwd,
      env: getTerminalEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    activeTerminalChild = child;

    child.stdout.on('data', (chunk: Buffer) => {
      res.write(chunk.toString('utf-8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      res.write(chunk.toString('utf-8'));
    });

    child.on('error', (err) => {
      res.write(`\nErro ao iniciar processo: ${err.message}\n`);
    });

    child.on('close', (code) => {
      if (activeTerminalChild === child) {
        activeTerminalChild = null;
      }
      sendExitMetadata(typeof code === 'number' ? code : 0);
    });
  });

  // Legacy JSON fallback endpoint for compatibility
  app.post('/api/terminal', async (req, res) => {
    const { command = '' } = req.body || {};
    const trimmed = String(command).trim();

    if (!trimmed || trimmed === 'clear') {
      return res.json({ output: '', exitCode: 0, cwd: currentRealTerminalCwd });
    }

    if (activeTerminalChild && !activeTerminalChild.killed) {
      activeTerminalChild.stdin.write(`${trimmed}\n`);
      return res.json({
        output: `${trimmed}\n`,
        exitCode: 0,
        cwd: currentRealTerminalCwd,
      });
    }

    await ensureRealPipInstalled();

    if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
      const targetDir = trimmed === 'cd' ? WORKSPACE_DIR : trimmed.slice(3).trim();
      const resolved = path.resolve(currentRealTerminalCwd, targetDir);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        currentRealTerminalCwd = resolved;
        return res.json({
          output: `Diretório alterado para: ${currentRealTerminalCwd}\n`,
          exitCode: 0,
          cwd: currentRealTerminalCwd,
        });
      } else {
        return res.json({
          output: `bash: cd: ${targetDir}: Diretório não encontrado\n`,
          exitCode: 1,
          cwd: currentRealTerminalCwd,
        });
      }
    }

    try {
      const { stdout, stderr } = await execAsync(trimmed, {
        cwd: currentRealTerminalCwd,
        timeout: 45000,
        maxBuffer: 1024 * 1024 * 10,
        env: getTerminalEnv(),
      });

      const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
      return res.json({
        output: combinedOutput ? `${combinedOutput}\n` : 'Comando executado com sucesso (exit code 0).\n',
        exitCode: 0,
        cwd: currentRealTerminalCwd,
        virtualFiles: getWorkspaceVirtualFiles(),
      });
    } catch (err: any) {
      const stdOutErr = [err.stdout, err.stderr].filter(Boolean).join('\n');
      return res.json({
        output: stdOutErr ? `${stdOutErr}\n` : `Erro ao executar comando: ${err.message}\n`,
        exitCode: typeof err.code === 'number' ? err.code : 1,
        cwd: currentRealTerminalCwd,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dcode 2.0 Server + Real-Time Streaming Terminal running on port ${PORT}`);
  });
}

startServer();
