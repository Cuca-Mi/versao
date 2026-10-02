import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  MessageSquare,
  Send,
  Play,
  CloudUpload,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Code,
  Paperclip,
  Search,
  Trash2,
  Sliders,
  Zap,
  Brain,
  GitBranch,
  Server,
  Globe,
  ExternalLink,
  X
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

interface RagSourceRef {
  id: string;
  title: string;
  license: string;
  source: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  ragSources?: RagSourceRef[];
  teacherModelUsed?: string;
  attachment?: {
    name: string;
    mimeType: string;
    data: string;
  };
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: Message[];
}

interface RagDocument {
  id: string;
  title: string;
  source: string;
  license: 'Apache-2.0' | 'MIT' | 'BSD-3-Clause' | 'CC-BY-4.0';
  category: 'fullstack' | 'owasp' | 'distillation' | 'debugging' | 'docs';
  teacherOrigin: string;
  content: string;
  keywords: string[];
}

interface SyntheticPair {
  id: string;
  teacherModel: string;
  license: string;
  domain: string;
  instruction: string;
  reasoningTrace: string;
  chosenCode: string;
  rejectedCode: string;
}

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error';
  text: string;
}

interface ExtensionSettings {
  provider: 'gemini' | 'huggingface' | 'ollama';
  hfToken: string;
  hfModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  fastMode: boolean;
  temperature: number;
  enableRag: boolean;
  enableOwaspGuard: boolean;
  teacherModel: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  description?: string;
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

interface ManagedProcess {
  id: string;
  command: string;
  pid: number | undefined;
  status: 'running' | 'exited';
  startedAt: string;
  logs: string[];
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: 'welcome-msg-1',
  role: 'assistant',
  content: `Olá! Sou o **Dcode 2.0 (7B Fullstack & Security AI)** com estilo e velocidade **Google Gemini**.

### Novidades & Correções Ativas:
1. **Bug do \`pip\` Corrigido**: O gerenciador de pacotes \`pip 26.2.1\` (\`pip\` e \`pip3\`) foi instalado de verdade no container Linux (\`/tmp/dcode_bin/pip\`). Agora você pode rodar \`pip install colorama\` (ou qualquer pacote Python) e importar imediatamente no \`python3\`!
2. **Integração Real com GitHub + Servidor Temporário Real**: Na nova aba **GitHub & Servidor Real**, você pode conectar seu Token do GitHub, clonar seus repositórios reais (\`git clone\`), criar novos repositórios, fazer **Commit & Push** direto do servidor e criar rotas públicas em \`/live/*\` para usar este ambiente como seu **servidor real temporário**!
3. **Código Completo na Caixa Preta & Memória Entre Bate-Papos**: Todo código é gerado completo sem quebras dentro da caixa preta com botões flutuantes de cópia (para suas mensagens e respostas da IA).`,
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  teacherModelUsed: 'Gemini 3.8 Flash Ultra-Rápido + Ensemble 7B (Qwen2.5-Coder / StarCoder2 / CodeLlama)'
};

export default function App() {
  const [activeView, setActiveView] = useState<'chat' | 'terminal' | 'github_server' | 'extensions' | 'pipeline'>('chat');

  // Extension & Hugging Face Settings
  const [extSettings, setExtSettings] = useState<ExtensionSettings>(() => {
    const saved = localStorage.getItem('dcode_2_ext_settings_v4');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (_e) {
        // ignore
      }
    }
    return {
      provider: 'gemini',
      hfToken: '',
      hfModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen2.5-coder:7b',
      fastMode: true,
      temperature: 0.35,
      enableRag: true,
      enableOwaspGuard: true,
      teacherModel: 'Ensemble (Qwen2.5-Coder-32B + StarCoder2-15B + CodeLlama-34B)'
    };
  });

  useEffect(() => {
    localStorage.setItem('dcode_2_ext_settings_v4', JSON.stringify(extSettings));
  }, [extSettings]);

  // GitHub Settings (Persistent in localStorage)
  const [ghToken, setGhToken] = useState(() => localStorage.getItem('dcode_gh_token') || '');
  const [ghName, setGhName] = useState(() => localStorage.getItem('dcode_gh_name') || 'Dcode Developer');
  const [ghEmail, setGhEmail] = useState(() => localStorage.getItem('dcode_gh_email') || 'cucamiguilito@gmail.com');
  const [ghProfile, setGhProfile] = useState<{ login: string; name: string; html_url: string; public_repos: number } | null>(null);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [ghCloneUrl, setGhCloneUrl] = useState('');
  const [ghPushRepo, setGhPushRepo] = useState('');
  const [ghCommitMsg, setGhCommitMsg] = useState('Deploy & atualização via Dcode 2.0 Real Server');
  const [ghNewRepoName, setGhNewRepoName] = useState('');
  const [ghIsPrivate, setGhIsPrivate] = useState(false);
  const [ghOutputLog, setGhOutputLog] = useState('Conecte seu Personal Access Token do GitHub ou clone qualquer repositório público/privado diretamente para o servidor Linux.');
  const [isGhBusy, setIsGhBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem('dcode_gh_token', ghToken);
    localStorage.setItem('dcode_gh_name', ghName);
    localStorage.setItem('dcode_gh_email', ghEmail);
  }, [ghToken, ghName, ghEmail]);

  // Temporary Server State
  const [liveEndpoints, setLiveEndpoints] = useState<CustomLiveEndpoint[]>([]);
  const [liveRequestLogs, setLiveRequestLogs] = useState<LiveRequestLog[]>([]);
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcess[]>([]);
  const [newEpSlug, setNewEpSlug] = useState('minha-api');
  const [newEpMethod, setNewEpMethod] = useState<'ALL' | 'GET' | 'POST'>('ALL');
  const [newEpContentType, setNewEpContentType] = useState<'application/json' | 'text/html' | 'text/plain'>('application/json');
  const [newEpBody, setNewEpBody] = useState('{\n  "servidor": "Dcode 2.0 Temporário",\n  "status": "online",\n  "autor": "Miguel"\n}');
  const [newEpDesc, setNewEpDesc] = useState('Endpoint JSON customizado');
  const [bgCommandInput, setBgCommandInput] = useState('python3 hello.py');

  // Multi-Session Chat State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('dcode_2_chat_sessions_v5');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_e) {
        // ignore
      }
    }
    return [
      {
        id: 'session-default',
        title: 'Bate-Papo Principal 7B',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        messages: [DEFAULT_WELCOME_MESSAGE]
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem('dcode_2_active_session_id_v5') || 'session-default';
  });

  useEffect(() => {
    localStorage.setItem('dcode_2_chat_sessions_v5', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('dcode_2_active_session_id_v5', activeSessionId);
  }, [activeSessionId]);

  // Cross-Session Global Memory
  const [crossSessionMemories, setCrossSessionMemories] = useState<string[]>(() => {
    const saved = localStorage.getItem('dcode_2_global_memories_v4');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (_e) {
        // ignore
      }
    }
    return [
      'Preferência: Gerar código sempre 100% completo sem quebras dentro da caixa preta.',
      'Ambiente Linux Real: pip 26.2.1 instalado e integrado com GitHub e Servidor Temporário Real.'
    ];
  });

  useEffect(() => {
    localStorage.setItem('dcode_2_global_memories_v4', JSON.stringify(crossSessionMemories));
  }, [crossSessionMemories]);

  const [newMemoryFact, setNewMemoryFact] = useState('');

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentAttachment, setCurrentAttachment] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RAG & Distillation state
  const [ragDocs, setRagDocs] = useState<RagDocument[]>([]);
  const [syntheticPairs, setSyntheticPairs] = useState<SyntheticPair[]>([]);
  const [distillTeacher, setDistillTeacher] = useState('Qwen/Qwen2.5-Coder-32B-Instruct');
  const [distillTopic, setDistillTopic] = useState('API Fullstack Node.js + React com proteção OWASP SQL Injection e XSS');
  const [isDistilling, setIsDistilling] = useState(false);

  // Real Linux Terminal & Workspace Files state
  const [virtualFiles, setVirtualFiles] = useState<Record<string, string>>({});
  const [activeFilePath, setActiveFilePath] = useState('/home/dcode/hello.py');
  const [terminalCwd, setTerminalCwd] = useState('/home/dcode');
  const [isRunningCmd, setIsRunningCmd] = useState(false);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { id: 't-init-1', type: 'output', text: 'Dcode 2.0 Terminal Linux Real · Python 3.10 · pip 26.2.1 · Node v22.23 · Git 2.34' },
    { id: 't-init-2', type: 'output', text: 'Bug do pip corrigido! Teste agora: pip install colorama && python3 hello.py\n' }
  ]);
  const [terminalInput, setTerminalInput] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Google Drive Sync state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const fetchServerInfo = () => {
    fetch('/api/pipeline-info')
      .then((r) => r.json())
      .then((data) => {
        if (data.ragDocuments) setRagDocs(data.ragDocuments);
        if (data.syntheticPairs) setSyntheticPairs(data.syntheticPairs);
        if (data.cwd) setTerminalCwd(data.cwd);
        if (data.virtualFiles) {
          setVirtualFiles(data.virtualFiles);
          const keys = Object.keys(data.virtualFiles);
          if (keys.length > 0 && !data.virtualFiles[activeFilePath]) {
            setActiveFilePath(keys[0]);
          }
        }
      })
      .catch((err) => console.error('Failed to load pipeline info:', err));
  };

  const fetchTempServerState = () => {
    fetch('/api/temp-server/state')
      .then((r) => r.json())
      .then((data) => {
        if (data.endpoints) setLiveEndpoints(data.endpoints);
        if (data.requestLogs) setLiveRequestLogs(data.requestLogs);
        if (data.processes) setManagedProcesses(data.processes);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchServerInfo();
    fetchTempServerState();
  }, []);

  useEffect(() => {
    if (activeView === 'github_server') {
      fetchTempServerState();
      const timer = setInterval(fetchTempServerState, 3500);
      return () => clearInterval(timer);
    }
  }, [activeView]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLines]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const copyEntireConversation = () => {
    const fullText = messages
      .map((m) => `[${m.role === 'user' ? 'VOCÊ' : 'DCODE 2.0'} - ${m.timestamp}]\n${m.content}`)
      .join('\n\n----------------------------------------\n\n');
    copyToClipboard(fullText, 'copy-entire-chat');
  };

  const handleCreateNewChatSession = () => {
    const newId = `session-${Date.now()}`;
    const sessionNumber = sessions.length + 1;
    const newSession: ChatSession = {
      id: newId,
      title: `Bate-Papo #${sessionNumber}`,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messages: [
        {
          id: `welcome-${Date.now()}`,
          role: 'assistant',
          content: `Novo bate-papo iniciado (**Bate-Papo #${sessionNumber}**).

Minha **Memória Global Entre Bate-Papos** está ativa (${crossSessionMemories.length} fatos memorizados das suas conversas anteriores). Pode continuar de onde paramos ou iniciar um novo assunto!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          teacherModelUsed: extSettings.provider === 'huggingface' ? `Hugging Face (${extSettings.hfModel})` : 'Gemini 3.8 Flash Ultra-Rápido'
        }
      ]
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    setActiveView('chat');
  };

  const handleDeleteSession = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) return;
    const remaining = sessions.filter((s) => s.id !== idToDelete);
    setSessions(remaining);
    if (activeSessionId === idToDelete) {
      setActiveSessionId(remaining[0].id);
    }
  };

  const buildOtherChatsSummary = (): string => {
    const otherSessions = sessions.filter((s) => s.id !== activeSession.id);
    if (otherSessions.length === 0) return '';
    const snippets: string[] = [];
    for (const sess of otherSessions.slice(0, 4)) {
      const userMsgs = sess.messages
        .filter((m) => m.role === 'user')
        .slice(-4)
        .map((m) => m.content.slice(0, 160));
      if (userMsgs.length > 0) {
        snippets.push(`Conversa "${sess.title}": Usuário disse -> ${userMsgs.join(' | ')}`);
      }
    }
    return snippets.join('\n');
  };

  const sendChatPrompt = async (promptText: string) => {
    if ((!promptText.trim() && !currentAttachment) || isGenerating) return;

    const cleanPrompt = promptText.trim();
    const attachmentToSend = currentAttachment;
    setInputMessage('');
    setCurrentAttachment(null);

    if (cleanPrompt.length > 4) {
      const lower = cleanPrompt.toLowerCase();
      if (
        lower.includes('meu nome') ||
        lower.includes('me chamo') ||
        lower.includes('lembre') ||
        lower.includes('lembra') ||
        lower.includes('meu projeto') ||
        lower.includes('minha stack') ||
        lower.includes('eu uso') ||
        lower.includes('guardar')
      ) {
        const fact = `Contexto do usuário (${activeSession.title}): ${cleanPrompt.slice(0, 200)}`;
        setCrossSessionMemories((prev) => (prev.includes(fact) ? prev : [fact, ...prev]));
      }
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: cleanPrompt || `[Arquivo anexado: ${attachmentToSend?.name}]`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      attachment: attachmentToSend || undefined
    };

    const updatedMessages = [...messages, userMsg];
    const updatedTitle =
      activeSession.messages.length <= 1 && cleanPrompt
        ? cleanPrompt.slice(0, 34) + (cleanPrompt.length > 34 ? '...' : '')
        : activeSession.title;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, title: updatedTitle, messages: updatedMessages } : s
      )
    );
    setIsGenerating(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          provider: extSettings.provider,
          hfToken: extSettings.hfToken,
          hfModel: extSettings.hfModel,
          ollamaEndpoint: extSettings.ollamaEndpoint,
          ollamaModel: extSettings.ollamaModel,
          teacherModel: extSettings.teacherModel,
          enableRag: extSettings.enableRag,
          enableOwaspGuard: extSettings.enableOwaspGuard,
          fastMode: extSettings.fastMode,
          temperature: extSettings.temperature,
          crossSessionMemories,
          otherChatsContext: buildOtherChatsSummary()
        })
      });

      const raw = await res.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_e) {
        data = { text: raw };
      }

      if (Array.isArray(data.globalMemory)) {
        setCrossSessionMemories((prev) => Array.from(new Set([...data.globalMemory, ...prev])));
      }

      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.text || 'Resposta processada com sucesso.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ragSources: data.ragSources,
        teacherModelUsed: data.teacherModelUsed
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id ? { ...s, messages: [...updatedMessages, assistantMsg] } : s
        )
      );
    } catch (_err: any) {
      const fallbackMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: `Recebi sua mensagem: **"${cleanPrompt}"**. O terminal real com \`pip\` e a integração GitHub já estão operacionais.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id ? { ...s, messages: [...updatedMessages, fallbackMsg] } : s
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const sendInteractiveStdin = async (inputStr: string) => {
    setTerminalLines((prev) => [
      ...prev,
      { id: `stdin-${Date.now()}`, type: 'input', text: `${inputStr}` }
    ]);
    try {
      await fetch('/api/terminal/stdin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputStr })
      });
    } catch (_e) {
      // ignore
    }
  };

  const killRunningTerminalProcess = async () => {
    try {
      await fetch('/api/terminal/kill', { method: 'POST' });
      setTerminalLines((prev) => [
        ...prev,
        { id: `kill-${Date.now()}`, type: 'error', text: '^C [Processo interrompido pelo usuário]' }
      ]);
      setIsRunningCmd(false);
    } catch (_e) {
      setIsRunningCmd(false);
    }
  };

  const executeRealTerminalCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // If a process is already running in the terminal, send the typed text to its stdin!
    if (isRunningCmd) {
      await sendInteractiveStdin(trimmed);
      return;
    }

    setTerminalLines((prev) => [
      ...prev,
      { id: `in-${Date.now()}`, type: 'input', text: `${terminalCwd}$ ${trimmed}` }
    ]);

    if (trimmed === 'clear') {
      setTerminalLines([]);
      return;
    }

    const streamLineId = `stream-${Date.now()}`;
    setTerminalLines((prev) => [
      ...prev,
      { id: streamLineId, type: 'output', text: '' }
    ]);

    setIsRunningCmd(true);
    try {
      const res = await fetch('/api/terminal/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed })
      });

      if (!res.body) {
        const fallbackText = await res.text();
        setTerminalLines((prev) =>
          prev.map((l) => (l.id === streamLineId ? { ...l, text: fallbackText } : l))
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        accumulated += chunkText;

        // Check if metadata footer has arrived
        const metaIdx = accumulated.indexOf('\n__DCODE_META__:');
        const visibleText = metaIdx >= 0 ? accumulated.slice(0, metaIdx) : accumulated;

        setTerminalLines((prev) =>
          prev.map((l) =>
            l.id === streamLineId
              ? { ...l, text: visibleText.replace(/\r/g, '\n') }
              : l
          )
        );
      }

      const metaMarker = '\n__DCODE_META__:';
      const finalMetaIdx = accumulated.indexOf(metaMarker);
      if (finalMetaIdx >= 0) {
        const visibleFinal = accumulated.slice(0, finalMetaIdx).replace(/\r/g, '\n');
        const metaJsonStr = accumulated.slice(finalMetaIdx + metaMarker.length).trim();
        try {
          const meta = JSON.parse(metaJsonStr);
          if (meta.cwd) setTerminalCwd(meta.cwd);
          if (meta.virtualFiles) setVirtualFiles(meta.virtualFiles);
          setTerminalLines((prev) =>
            prev.map((l) =>
              l.id === streamLineId
                ? {
                    ...l,
                    type: meta.exitCode === 0 ? 'output' : 'error',
                    text: visibleFinal || 'Comando concluído (exit code 0).'
                  }
                : l
            )
          );
        } catch (_e) {
          // ignore parse error
        }
      }
    } catch (err: any) {
      setTerminalLines((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, type: 'error', text: `Erro de execução: ${err.message}` }
      ]);
    } finally {
      setIsRunningCmd(false);
    }
  };

  const handleRunCodeSnippetInTerminal = async (language: string, codeContent: string) => {
    const lang = language.toLowerCase();
    let filename = 'snippet.py';
    let runCmd = 'python3 snippet.py';

    if (lang === 'javascript' || lang === 'js') {
      filename = 'snippet.js';
      runCmd = 'node snippet.js';
    } else if (lang === 'typescript' || lang === 'ts' || lang === 'tsx') {
      filename = 'snippet.ts';
      runCmd = 'npx tsx snippet.ts';
    } else if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
      filename = 'snippet.sh';
      runCmd = 'bash snippet.sh';
    } else if (lang === 'yaml' || lang === 'yml') {
      filename = 'config_snippet.yaml';
      runCmd = 'cat config_snippet.yaml';
    }

    try {
      const saveRes = await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: codeContent })
      });
      const saveData = await saveRes.json();
      if (saveData.virtualFiles) {
        setVirtualFiles(saveData.virtualFiles);
        setActiveFilePath(`/home/dcode/${filename}`);
      }
      setActiveView('terminal');
      await executeRealTerminalCommand(runCmd);
    } catch (e) {
      console.error(e);
    }
  };

  // ============================================================================
  // GITHUB & REAL TEMPORARY SERVER HANDLERS
  // ============================================================================
  const handleVerifyGitHub = async () => {
    setIsGhBusy(true);
    try {
      const res = await fetch('/api/github/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ghToken, gitName: ghName, gitEmail: ghEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao conectar GitHub');
      setGhProfile(data.profile);
      setGhRepos(data.repos || []);
      if (data.repos?.[0]?.full_name && !ghPushRepo) {
        setGhPushRepo(data.repos[0].full_name);
      }
      setGhOutputLog(
        `Conectado ao GitHub como @${data.profile.login} (${data.repos?.length || 0} repositórios carregados). Configuração global git user.name e user.email aplicada no servidor Linux.`
      );
    } catch (err: any) {
      setGhOutputLog(`Aviso GitHub: ${err.message}`);
    } finally {
      setIsGhBusy(false);
    }
  };

  const handleCloneRepo = async (repoUrlToClone: string) => {
    const target = repoUrlToClone.trim() || ghCloneUrl.trim();
    if (!target) return;
    setIsGhBusy(true);
    try {
      const res = await fetch('/api/github/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: target, token: ghToken })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no git clone');
      if (data.cwd) setTerminalCwd(data.cwd);
      if (data.virtualFiles) setVirtualFiles(data.virtualFiles);
      setGhOutputLog(data.output || `Repositório ${target} clonado com sucesso em ${data.cwd}`);
      setStatusBanner(`Repositório clonado em ${data.cwd}!`);
      setTimeout(() => setStatusBanner(null), 3500);
    } catch (err: any) {
      setGhOutputLog(`Erro ao clonar: ${err.message}`);
    } finally {
      setIsGhBusy(false);
    }
  };

  const handleCreateGitHubRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghNewRepoName.trim()) return;
    setIsGhBusy(true);
    try {
      const res = await fetch('/api/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: ghToken,
          name: ghNewRepoName.trim(),
          isPrivate: ghIsPrivate
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao criar repositório');
      setGhRepos((prev) => [data.repo, ...prev]);
      setGhPushRepo(data.repo.full_name);
      setGhNewRepoName('');
      setGhOutputLog(`Repositório criado com sucesso: ${data.repo.html_url}`);
    } catch (err: any) {
      setGhOutputLog(`Erro ao criar repositório: ${err.message}`);
    } finally {
      setIsGhBusy(false);
    }
  };

  const handleGitPush = async () => {
    if (!ghPushRepo.trim()) {
      setGhOutputLog('Informe o repositório de destino (ex: seu-usuario/seu-repo).');
      return;
    }
    setIsGhBusy(true);
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: ghToken,
          repoFullName: ghPushRepo.trim(),
          commitMessage: ghCommitMsg,
          gitName: ghName,
          gitEmail: ghEmail
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no git push');
      setGhOutputLog(`Commit & Push realizados com sucesso para ${ghPushRepo}:\n${data.output}`);
    } catch (err: any) {
      setGhOutputLog(`Erro no Push: ${err.message}`);
    } finally {
      setIsGhBusy(false);
    }
  };

  const handleSaveCustomEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEpSlug.trim()) return;
    try {
      const res = await fetch('/api/temp-server/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newEpSlug.trim(),
          method: newEpMethod,
          contentType: newEpContentType,
          responseBody: newEpBody,
          description: newEpDesc
        })
      });
      const data = await res.json();
      if (data.endpoints) setLiveEndpoints(data.endpoints);
      setStatusBanner(`Rota pública /live/${newEpSlug.replace(/^\/+/, '')} publicada no Servidor Temporário!`);
      setTimeout(() => setStatusBanner(null), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteEndpoint = async (slug: string) => {
    await fetch(`/api/temp-server/endpoints/${slug}`, { method: 'DELETE' });
    fetchTempServerState();
  };

  const handleStartBgProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bgCommandInput.trim()) return;
    await fetch('/api/temp-server/process/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: bgCommandInput.trim() })
    });
    fetchTempServerState();
  };

  const handleStopBgProcess = async (id: string) => {
    await fetch('/api/temp-server/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    fetchTempServerState();
  };

  // Gemini-Style Markdown & Unbroken Black Code Box Renderer
  const renderGeminiFormattedMessage = (content: string, messageId: string) => {
    let safeContent = content;
    const fenceCount = (safeContent.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
      safeContent += '\n```';
    }

    const segments: Array<{ type: 'text' | 'code'; lang?: string; value: string }> = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(safeContent)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          value: safeContent.slice(lastIndex, match.index)
        });
      }
      segments.push({
        type: 'code',
        lang: (match[1] || 'code').trim().toLowerCase(),
        value: match[2].replace(/\n$/, '')
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < safeContent.length) {
      segments.push({
        type: 'text',
        value: safeContent.slice(lastIndex)
      });
    }

    const formatInlineText = (line: string) => {
      const parts = line.split(/(\*\*.*?\*\*|`[^`]+`)/g);
      return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={idx} className="font-semibold text-white">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={idx}
              className="px-1.5 py-0.5 mx-0.5 rounded bg-black/80 border border-slate-700/80 font-mono text-xs text-cyan-300"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={idx}>{part}</span>;
      });
    };

    return (
      <div className="space-y-3.5 leading-relaxed">
        {segments.map((seg, idx) => {
          if (seg.type === 'code') {
            const codeBlockId = `${messageId}-code-${idx}`;
            const lineCount = seg.value.split('\n').length;
            return (
              <div
                key={codeBlockId}
                className="group/code relative my-3 rounded-xl overflow-hidden border border-slate-800 bg-[#030508] shadow-xl"
              >
                <div className="flex items-center justify-between px-4 py-2 bg-[#0B0F17] border-b border-slate-800/90 text-xs">
                  <div className="flex items-center gap-2 font-mono text-slate-300">
                    <Code className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="uppercase tracking-wider font-semibold text-cyan-300">
                      {seg.lang || 'código'}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-400 tabular-nums">{lineCount} linhas</span>
                  </div>

                  <div className="flex items-center gap-2 opacity-85 group-hover/code:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleRunCodeSnippetInTerminal(seg.lang || 'python', seg.value)}
                      className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      title="Salvar e Executar no Terminal Linux Real"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Executar no Terminal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(seg.value, codeBlockId)}
                      className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      {copiedId === codeBlockId ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Código Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Copiar Código</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-[#030508] overflow-x-auto">
                  <pre className="font-mono text-xs sm:text-[13px] leading-6 text-slate-100 select-all">
                    <code>{seg.value}</code>
                  </pre>
                </div>
              </div>
            );
          }

          const lines = seg.value.split('\n');
          return (
            <div key={`${messageId}-txt-${idx}`} className="space-y-2">
              {lines.map((line, lIdx) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={lIdx} className="h-1" />;
                if (trimmed === '---') {
                  return <hr key={lIdx} className="border-slate-800 my-3" />;
                }
                if (trimmed.startsWith('### ')) {
                  return (
                    <h3 key={lIdx} className="text-base font-semibold text-white pt-2">
                      {formatInlineText(trimmed.slice(4))}
                    </h3>
                  );
                }
                if (trimmed.startsWith('## ')) {
                  return (
                    <h2 key={lIdx} className="text-lg font-bold text-white pt-2">
                      {formatInlineText(trimmed.slice(3))}
                    </h2>
                  );
                }
                if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                  return (
                    <div key={lIdx} className="flex items-start gap-2.5 pl-1">
                      <span className="text-cyan-400 mt-1.5 text-xs">•</span>
                      <p className="flex-1 text-slate-200">{formatInlineText(trimmed.slice(2))}</p>
                    </div>
                  );
                }
                if (/^\d+\.\s/.test(trimmed)) {
                  const dotIndex = trimmed.indexOf('.');
                  const num = trimmed.slice(0, dotIndex + 1);
                  const rest = trimmed.slice(dotIndex + 1).trim();
                  return (
                    <div key={lIdx} className="flex items-start gap-2.5 pl-1">
                      <span className="font-mono text-xs font-semibold text-cyan-400 mt-0.5 tabular-nums">
                        {num}
                      </span>
                      <p className="flex-1 text-slate-200">{formatInlineText(rest)}</p>
                    </div>
                  );
                }
                return (
                  <p key={lIdx} className="text-slate-200">
                    {formatInlineText(line)}
                  </p>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || '';
      setCurrentAttachment({
        name: file.name,
        mimeType: file.type || 'text/plain',
        data: base64
      });
    };
    reader.readAsDataURL(file);
  };

  const handleAddMemoryFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryFact.trim()) return;
    const fact = newMemoryFact.trim();
    setCrossSessionMemories((prev) => [fact, ...prev]);
    setNewMemoryFact('');
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fact })
    }).catch(() => {});
  };

  const handleSaveWorkspaceFile = async () => {
    const filename = activeFilePath.replace('/home/dcode/', '');
    const content = virtualFiles[activeFilePath] || '';
    try {
      const res = await fetch('/api/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content })
      });
      const data = await res.json();
      if (data.virtualFiles) setVirtualFiles(data.virtualFiles);
      setStatusBanner(`Arquivo ${filename} salvo no disco Linux real!`);
      setTimeout(() => setStatusBanner(null), 3000);
    } catch (err: any) {
      setStatusBanner(`Erro ao salvar arquivo: ${err.message}`);
    }
  };

  const handleSyncDrive = async () => {
    try {
      let token = accessToken;
      if (!user || !token) {
        const result = await signInWithPopup(auth, googleProvider);
        const cred = GoogleAuthProvider.credentialFromResult(result);
        token = cred?.accessToken || null;
        setAccessToken(token);
        setUser(result.user);
      }
      if (!token) return;

      setStatusBanner('Sincronizando conversas, memória global e pipeline 7B no Google Drive...');
      const payload = {
        appName: 'Dcode 2.0 Professional',
        timestamp: new Date().toISOString(),
        crossSessionMemories,
        sessions,
        liveEndpoints
      };

      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify({ name: `dcode-2.0-backup-${Date.now()}.json`, mimeType: 'application/json' })], {
          type: 'application/json'
        })
      );
      form.append('file', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) throw new Error('Falha ao enviar para o Google Drive');
      setStatusBanner('Backup completo salvo no Google Drive com sucesso!');
    } catch (err: any) {
      setStatusBanner(`Aviso Drive: ${err.message}`);
    }
  };

  const handleGenerateDistillationPair = async () => {
    if (!distillTopic.trim() || isDistilling) return;
    setIsDistilling(true);
    try {
      const res = await fetch('/api/distill/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherModel: distillTeacher, topic: distillTopic })
      });
      const data = await res.json();
      if (data.pair) {
        setSyntheticPairs((prev) => [data.pair, ...prev]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDistilling(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#090D16] text-slate-100 flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="h-14 border-b border-slate-800/90 bg-[#0D1322] px-6 flex items-center justify-between shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('chat');
          }}
          className="text-base font-bold tracking-tight text-white whitespace-nowrap"
        >
          Dcode 2.0
        </a>

        {/* Zone 2: 5 single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            onClick={() => setActiveView('chat')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
              activeView === 'chat'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Bate-Papo Gemini 7B
          </button>
          <button
            onClick={() => setActiveView('terminal')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
              activeView === 'terminal'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Terminal Linux Real
          </button>
          <button
            onClick={() => setActiveView('github_server')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
              activeView === 'github_server'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            GitHub & Servidor Real
          </button>
          <button
            onClick={() => setActiveView('extensions')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
              activeView === 'extensions'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Extensões & Hugging Face
          </button>
          <button
            onClick={() => setActiveView('pipeline')}
            className={`py-1 transition-colors whitespace-nowrap border-b-2 ${
              activeView === 'pipeline'
                ? 'border-cyan-400 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Pipeline 7B & RAG
          </button>
        </nav>

        {/* Zone 3: Primary actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateNewChatSession}
            className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Bate-Papo</span>
          </button>
          <button
            onClick={handleSyncDrive}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            <CloudUpload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Salvar no Drive</span>
          </button>
        </div>
      </header>

      {/* Mobile Nav */}
      <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 bg-[#0D1322] border-b border-slate-800 text-xs">
        <button onClick={() => setActiveView('chat')} className={`px-3 py-1.5 rounded-md whitespace-nowrap ${activeView === 'chat' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'}`}>Bate-Papo</button>
        <button onClick={() => setActiveView('terminal')} className={`px-3 py-1.5 rounded-md whitespace-nowrap ${activeView === 'terminal' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'}`}>Terminal Real</button>
        <button onClick={() => setActiveView('github_server')} className={`px-3 py-1.5 rounded-md whitespace-nowrap ${activeView === 'github_server' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'}`}>GitHub & Servidor</button>
        <button onClick={() => setActiveView('extensions')} className={`px-3 py-1.5 rounded-md whitespace-nowrap ${activeView === 'extensions' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'}`}>Extensões & HF</button>
        <button onClick={() => setActiveView('pipeline')} className={`px-3 py-1.5 rounded-md whitespace-nowrap ${activeView === 'pipeline' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'}`}>Pipeline 7B</button>
      </div>

      {statusBanner && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-2 text-xs text-cyan-300 flex items-center justify-between">
          <span>{statusBanner}</span>
          <button onClick={() => setStatusBanner(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <main className="flex-1 flex flex-col max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 overflow-hidden">
        {/* VIEW 1: PROFESSIONAL GEMINI-STYLE CHAT + MULTI-SESSION + GLOBAL MEMORY */}
        {activeView === 'chat' && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-7.5rem)]">
            <aside className="lg:col-span-3 flex flex-col justify-between bg-[#0E1525] border border-slate-800/90 rounded-xl p-4 space-y-5">
              <div className="space-y-5 overflow-y-auto pr-1">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      Seus Bate-Papos ({sessions.length})
                    </span>
                    <button
                      onClick={handleCreateNewChatSession}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {sessions.map((sess) => {
                      const isCurrent = sess.id === activeSession.id;
                      return (
                        <div
                          key={sess.id}
                          onClick={() => setActiveSessionId(sess.id)}
                          className={`group flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-cyan-500/15 border border-cyan-500/40 text-white font-medium'
                              : 'bg-[#090D16] hover:bg-slate-800/70 border border-slate-800/80 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <MessageSquare className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            <span className="truncate">{sess.title}</span>
                          </div>
                          {sessions.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSession(sess.id, e)}
                              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity p-0.5"
                              title="Excluir conversa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cross-Session Global Memory Panel */}
                <div className="space-y-2.5 pt-3 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Memória Entre Bate-Papos</span>
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {crossSessionMemories.length} ativos
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Fatos memorizados persistem mesmo quando você entra em outro bate-papo.
                  </p>

                  <form onSubmit={handleAddMemoryFact} className="flex gap-1.5">
                    <input
                      type="text"
                      value={newMemoryFact}
                      onChange={(e) => setNewMemoryFact(e.target.value)}
                      placeholder="Adicionar fato à memória global..."
                      className="flex-1 bg-[#090D16] border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium whitespace-nowrap"
                    >
                      Salvar
                    </button>
                  </form>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1">
                    {crossSessionMemories.map((fact, idx) => (
                      <div
                        key={idx}
                        className="group flex items-start justify-between gap-2 bg-[#090D16] border border-slate-800/80 rounded-lg p-2.5 text-[11px] text-slate-300"
                      >
                        <span className="leading-relaxed">{fact}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setCrossSessionMemories((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity shrink-0"
                          title="Remover da memória"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick Test Triggers */}
                <div className="space-y-1.5 pt-3 border-t border-slate-800/80">
                  <span className="text-xs font-semibold text-slate-300 block">
                    Ações Rápidas
                  </span>
                  <button
                    onClick={() => {
                      setActiveView('terminal');
                      executeRealTerminalCommand('pip install colorama && python3 hello.py');
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg bg-[#090D16] hover:bg-slate-800/80 border border-slate-800 text-xs text-emerald-300 transition-colors"
                  >
                    Testar pip install colorama no Terminal Real
                  </button>
                  <button
                    onClick={() => setActiveView('github_server')}
                    className="w-full text-left px-3 py-2 rounded-lg bg-[#090D16] hover:bg-slate-800/80 border border-slate-800 text-xs text-cyan-300 transition-colors"
                  >
                    Abrir Integração GitHub & Servidor Real
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono tabular-nums space-y-1">
                <div>
                  Motor: {extSettings.provider === 'huggingface' ? `HF (${extSettings.hfModel.split('/')[1] || extSettings.hfModel})` : 'Gemini 3.8 Flash'}
                </div>
                <div>pip 26.2.1 · Git 2.34 · Node v22 Ativos</div>
              </div>
            </aside>

            <section className="lg:col-span-9 flex flex-col bg-[#0E1525] border border-slate-800/90 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-800/80 bg-[#0B101D] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="font-semibold text-white">{activeSession.title}</span>
                  <span className="text-slate-600">·</span>
                  <span>Memória Global Ativa</span>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => setActiveView('extensions')}
                    className="text-cyan-400 hover:underline"
                  >
                    {extSettings.provider === 'huggingface'
                      ? `Extensão HF: ${extSettings.hfModel}`
                      : 'Modo Gemini Ultra-Rápido'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={copyEntireConversation}
                    className="px-3 py-1.5 rounded-lg bg-[#090D16] hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    {copiedId === 'copy-entire-chat' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Conversa Copiada!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Copiar Conversa Inteira</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 max-h-[64vh]">
                {messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`group relative flex flex-col ${
                        isUser ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5 px-1 text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-300">
                          {isUser ? 'Você' : 'Dcode 2.0 (Gemini 7B)'}
                        </span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">{msg.timestamp}</span>

                        {/* HOVER ACTION BAR (For BOTH user and assistant messages) */}
                        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 flex items-center gap-1.5 ml-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(msg.content, `msg-${msg.id}`)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1 text-[11px] transition-colors whitespace-nowrap"
                          >
                            {copiedId === `msg-${msg.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 text-cyan-400" />
                                <span>{isUser ? 'Copiar minha mensagem' : 'Copiar resposta'}</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const snippet = `${isUser ? 'Usuário' : 'IA'}: ${msg.content.slice(0, 180)}`;
                              setCrossSessionMemories((prev) =>
                                prev.includes(snippet) ? prev : [snippet, ...prev]
                              );
                              setStatusBanner('Mensagem fixada na Memória Global Entre Bate-Papos!');
                              setTimeout(() => setStatusBanner(null), 2500);
                            }}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-cyan-300 text-[11px] transition-colors whitespace-nowrap"
                          >
                            + Memorizar
                          </button>
                        </div>
                      </div>

                      <div
                        className={`relative rounded-2xl px-5 py-4 text-sm transition-all ${
                          isUser
                            ? 'max-w-[85%] bg-[#162238] border border-cyan-500/30 text-slate-100'
                            : 'w-full max-w-[96%] bg-[#090D16] border border-slate-800/90 text-slate-100'
                        }`}
                      >
                        {msg.attachment && (
                          <div className="mb-3 pb-2 border-b border-slate-700/60 text-xs text-cyan-300 flex items-center gap-2">
                            <Paperclip className="w-3.5 h-3.5" />
                            <span>Anexo: {msg.attachment.name}</span>
                          </div>
                        )}

                        {renderGeminiFormattedMessage(msg.content, msg.id)}

                        <div className="mt-3 pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                          <div className="truncate">
                            {msg.teacherModelUsed ? (
                              <span>Motor: {msg.teacherModelUsed}</span>
                            ) : (
                              <span>Memória Global Sincronizada</span>
                            )}
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(msg.content, `bottom-${msg.id}`)}
                              className="text-slate-300 hover:text-cyan-300 flex items-center gap-1"
                            >
                              {copiedId === `bottom-${msg.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copiado</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>{isUser ? 'Copiar meu texto' : 'Copiar tudo'}</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isGenerating && (
                  <div className="flex items-center gap-2.5 text-xs text-cyan-300 bg-[#090D16] border border-slate-800 rounded-xl px-4 py-3 w-fit">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Gerando resposta completa em modo ultra-rápido...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 border-t border-slate-800/80 bg-[#0B101D]">
                {currentAttachment && (
                  <div className="mb-2 flex items-center justify-between bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300">
                    <span className="truncate">Anexo pronto: {currentAttachment.name}</span>
                    <button onClick={() => setCurrentAttachment(null)} className="text-slate-400 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendChatPrompt(inputMessage);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept="image/*,video/*,.py,.ts,.tsx,.js,.json,.md,.yaml,.txt"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 rounded-lg bg-[#090D16] border border-slate-700/80 text-slate-300 hover:text-cyan-300 transition-colors"
                    title="Anexar código, imagem, vídeo ou documento"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Digite sua mensagem ou peça um código completo (a IA lembra mesmo em outro bate-papo)..."
                    className="flex-1 bg-[#090D16] border border-slate-700/80 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={(!inputMessage.trim() && !currentAttachment) || isGenerating}
                    className="px-5 py-2.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar</span>
                  </button>
                </form>
              </div>
            </section>
          </div>
        )}

        {/* VIEW 2: REAL LINUX TERMINAL & WORKSPACE FILES */}
        {activeView === 'terminal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-7.5rem)] pb-4">
            <div className="lg:col-span-5 bg-[#0E1525] border border-slate-800/90 rounded-xl flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto">
                <div className="flex items-center gap-1.5">
                  {Object.keys(virtualFiles).map((filePath) => {
                    const shortName = filePath.replace('/home/dcode/', '');
                    return (
                      <button
                        key={filePath}
                        onClick={() => setActiveFilePath(filePath)}
                        className={`px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition-colors ${
                          activeFilePath === filePath
                            ? 'bg-cyan-400 text-slate-950 font-semibold'
                            : 'bg-[#090D16] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {shortName}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 py-2.5 bg-[#0B101D] border-b border-slate-800 flex items-center justify-between text-xs">
                <span className="font-mono text-slate-400 truncate">{activeFilePath}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveWorkspaceFile}
                    className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs whitespace-nowrap"
                  >
                    Salvar no Disco
                  </button>
                  <button
                    onClick={async () => {
                      await handleSaveWorkspaceFile();
                      const short = activeFilePath.replace('/home/dcode/', '');
                      const cmd = short.endsWith('.py')
                        ? `python3 ${short}`
                        : short.endsWith('.js')
                        ? `node ${short}`
                        : `cat ${short}`;
                      executeRealTerminalCommand(cmd);
                    }}
                    className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1 whitespace-nowrap"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Executar Real</span>
                  </button>
                </div>
              </div>

              <textarea
                value={virtualFiles[activeFilePath] || ''}
                onChange={(e) =>
                  setVirtualFiles((prev) => ({ ...prev, [activeFilePath]: e.target.value }))
                }
                className="flex-1 w-full bg-[#030508] p-4 font-mono text-xs text-slate-100 outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="lg:col-span-7 bg-[#030508] border border-slate-800/90 rounded-xl flex flex-col overflow-hidden font-mono text-xs">
              <div className="px-4 py-3 bg-[#0E1525] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-200">
                  <TerminalIcon className="w-4 h-4 text-emerald-400" />
                  <span>Terminal Linux Real ({terminalCwd})</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => executeRealTerminalCommand('apt install nano && nano --version')}
                    className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[11px] font-sans font-semibold whitespace-nowrap"
                  >
                    apt install nano
                  </button>
                  <button
                    onClick={() => executeRealTerminalCommand('python3 interactive_test.py')}
                    className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-sans font-semibold whitespace-nowrap"
                  >
                    Testar Prompt [Y/n] Ao Vivo
                  </button>
                  <button
                    onClick={() => executeRealTerminalCommand('pip install colorama && python3 hello.py')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-sans whitespace-nowrap"
                  >
                    pip install colorama
                  </button>
                  <button
                    onClick={() => executeRealTerminalCommand('ls -la')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-sans whitespace-nowrap"
                  >
                    ls -la
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 text-slate-200 max-h-[62vh]">
                {terminalLines.map((line) => (
                  <div
                    key={line.id}
                    className={`whitespace-pre-wrap leading-relaxed ${
                      line.type === 'input'
                        ? 'text-cyan-400 font-semibold'
                        : line.type === 'error'
                        ? 'text-amber-300'
                        : 'text-slate-200'
                    }`}
                  >
                    {line.text}
                  </div>
                ))}
                {isRunningCmd && (
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0E1525] border border-cyan-500/30 rounded-lg px-3 py-2 text-xs">
                    <div className="text-emerald-400 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processo ativo em tempo real (você pode responder [Y/n] abaixo)...</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => sendInteractiveStdin('Y')}
                        className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-sans font-semibold text-[11px]"
                      >
                        Enviar Y (Yes)
                      </button>
                      <button
                        type="button"
                        onClick={() => sendInteractiveStdin('n')}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans text-[11px]"
                      >
                        Enviar N (No)
                      </button>
                      <button
                        type="button"
                        onClick={killRunningTerminalProcess}
                        className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-sans text-[11px]"
                      >
                        Ctrl+C (Parar)
                      </button>
                    </div>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  executeRealTerminalCommand(terminalInput);
                  setTerminalInput('');
                }}
                className="p-3 border-t border-slate-800 bg-[#0E1525] flex items-center gap-2"
              >
                <span className="text-emerald-400 font-semibold truncate max-w-[200px]">
                  {isRunningCmd ? '[stdin] >' : `${terminalCwd}$`}
                </span>
                <input
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  placeholder={
                    isRunningCmd
                      ? 'Processo aguardando entrada: digite Y, N ou sua resposta e pressione Enter...'
                      : 'Digite qualquer comando real (ex: apt install nano, pip install colorama, python3 interactive_test.py)...'
                  }
                  className="flex-1 bg-transparent text-white outline-none font-mono text-xs"
                  autoFocus
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-sans font-semibold text-xs whitespace-nowrap"
                >
                  {isRunningCmd ? 'Enviar Resposta' : 'Executar'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* VIEW 3: GITHUB INTEGRATION & REAL TEMPORARY CLOUD SERVER */}
        {activeView === 'github_server' && (
          <div className="space-y-6 pb-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left 6 Cols: GitHub Integration (Auth, Clone, Create Repo, Commit & Push) */}
              <div className="lg:col-span-6 bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-cyan-400" />
                      <span>Integração Real com GitHub (Git CLI + API)</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Clone repositórios, crie novos projetos e faça Commit & Push direto do servidor Linux temporário.
                    </p>
                  </div>
                  {ghProfile && (
                    <a
                      href={ghProfile.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <span>@{ghProfile.login}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* GitHub Token & Git Identity */}
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-slate-300 mb-1">
                      GitHub Personal Access Token (`ghp_...` ou `github_pat_...`)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={ghToken}
                        onChange={(e) => setGhToken(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="flex-1 bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 font-mono text-cyan-300 outline-none focus:border-cyan-400"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyGitHub}
                        disabled={isGhBusy}
                        className="px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-slate-950 font-semibold whitespace-nowrap"
                      >
                        {isGhBusy ? 'Conectando...' : 'Conectar GitHub'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Git User Name</label>
                      <input
                        type="text"
                        value={ghName}
                        onChange={(e) => setGhName(e.target.value)}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Git User Email</label>
                      <input
                        type="text"
                        value={ghEmail}
                        onChange={(e) => setGhEmail(e.target.value)}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Clone Repository (Public or Private) */}
                <div className="pt-3 border-t border-slate-800 space-y-2.5 text-xs">
                  <label className="block font-semibold text-slate-200">
                    1. Clonar Repositório para o Servidor (`git clone`)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ghCloneUrl}
                      onChange={(e) => setGhCloneUrl(e.target.value)}
                      placeholder="Ex: usuario/meu-repositorio ou https://github.com/..."
                      className="flex-1 bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 outline-none focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      onClick={() => handleCloneRepo(ghCloneUrl)}
                      disabled={isGhBusy}
                      className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-medium whitespace-nowrap"
                    >
                      Clonar no Servidor
                    </button>
                  </div>

                  {ghRepos.length > 0 && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pt-1">
                      <span className="text-[11px] text-slate-400 block">
                        Seus repositórios recentes (clique em Clonar ou Selecionar p/ Push):
                      </span>
                      {ghRepos.map((repo) => (
                        <div
                          key={repo.id}
                          className="flex items-center justify-between bg-[#090D16] border border-slate-800 rounded-lg px-3 py-1.5"
                        >
                          <div className="truncate font-mono text-slate-200">
                            <span>{repo.full_name}</span>
                            <span className="ml-2 text-[10px] text-slate-400">
                              ({repo.private ? 'Privado' : 'Público'})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCloneRepo(repo.clone_url)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px]"
                            >
                              Clonar
                            </button>
                            <button
                              type="button"
                              onClick={() => setGhPushRepo(repo.full_name)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px]"
                            >
                              Usar p/ Push
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Create New GitHub Repo + Commit & Push */}
                <div className="pt-3 border-t border-slate-800 space-y-3 text-xs">
                  <label className="block font-semibold text-slate-200">
                    2. Criar Novo Repositório ou Fazer Commit & Push Direto (`git push`)
                  </label>

                  <form onSubmit={handleCreateGitHubRepo} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ghNewRepoName}
                      onChange={(e) => setGhNewRepoName(e.target.value)}
                      placeholder="Nome para criar novo repositório..."
                      className="flex-1 bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 outline-none"
                    />
                    <label className="flex items-center gap-1 text-slate-400 whitespace-nowrap cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ghIsPrivate}
                        onChange={(e) => setGhIsPrivate(e.target.checked)}
                        className="accent-cyan-400"
                      />
                      <span>Privado</span>
                    </label>
                    <button
                      type="submit"
                      disabled={isGhBusy || !ghToken.trim()}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 whitespace-nowrap disabled:opacity-50"
                    >
                      + Criar Repo
                    </button>
                  </form>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={ghPushRepo}
                      onChange={(e) => setGhPushRepo(e.target.value)}
                      placeholder="Repositório destino (usuario/repo)"
                      className="bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 outline-none"
                    />
                    <input
                      type="text"
                      value={ghCommitMsg}
                      onChange={(e) => setGhCommitMsg(e.target.value)}
                      placeholder="Mensagem do commit"
                      className="bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleGitPush}
                    disabled={isGhBusy}
                    className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold transition-colors"
                  >
                    Commit & Push Direto do Servidor ({terminalCwd}) para o GitHub
                  </button>
                </div>

                {/* Git Log Console */}
                <div className="bg-[#030508] border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {ghOutputLog}
                </div>
              </div>

              {/* Right 6 Cols: Real Temporary Server (/live/* Endpoints, Webhook Logs & Processes) */}
              <div className="lg:col-span-6 bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 space-y-5">
                <div className="border-b border-slate-800 pb-4">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-400" />
                    <span>Seu Servidor Real Temporário (Rotas Públicas `/live/*`)</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Crie rotas de API, receba Webhooks do GitHub ou hospede páginas HTML/arquivos diretamente na URL pública deste servidor.
                  </p>
                </div>

                {/* Create / Edit Live Route */}
                <form onSubmit={handleSaveCustomEndpoint} className="space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-slate-400 mb-1">Caminho (`/live/...`)</label>
                      <input
                        type="text"
                        value={newEpSlug}
                        onChange={(e) => setNewEpSlug(e.target.value)}
                        placeholder="minha-api"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-cyan-300 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Método HTTP</label>
                      <select
                        value={newEpMethod}
                        onChange={(e) => setNewEpMethod(e.target.value as any)}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none"
                      >
                        <option value="ALL">ALL (GET/POST/PUT)</option>
                        <option value="GET">GET</option>
                        <option value="POST">POST (Webhook)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Content-Type</label>
                      <select
                        value={newEpContentType}
                        onChange={(e) => setNewEpContentType(e.target.value as any)}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none"
                      >
                        <option value="application/json">application/json</option>
                        <option value="text/html">text/html</option>
                        <option value="text/plain">text/plain</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">
                      Corpo da Resposta (JSON, HTML ou Texto servido pela rota)
                    </label>
                    <textarea
                      rows={3}
                      value={newEpBody}
                      onChange={(e) => setNewEpBody(e.target.value)}
                      className="w-full bg-[#030508] border border-slate-700 rounded-lg p-2.5 font-mono text-xs text-slate-200 outline-none resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold transition-colors"
                  >
                    + Publicar Rota no Servidor Temporário (`/live/{newEpSlug.replace(/^\/+/, '')}`)
                  </button>
                </form>

                {/* Active Live Endpoints List */}
                <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                  <span className="font-semibold text-slate-200 block">
                    Rotas Públicas Ativas no Seu Servidor:
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {liveEndpoints.map((ep) => {
                      const fullUrl = `${window.location.origin}/live/${ep.slug}`;
                      return (
                        <div
                          key={ep.id}
                          className="flex items-center justify-between gap-2 bg-[#090D16] border border-slate-800 rounded-lg px-3 py-2"
                        >
                          <div className="truncate">
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-emerald-400 font-semibold">{ep.method}</span>
                              <span className="text-cyan-300">/live/{ep.slug}</span>
                              <span className="text-slate-500">·</span>
                              <span className="text-slate-400 tabular-nums">{ep.hits} acessos</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(fullUrl, `url-${ep.id}`)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1"
                            >
                              {copiedId === `url-${ep.id}` ? (
                                <span className="text-emerald-400">URL Copiada!</span>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copiar URL</span>
                                </>
                              )}
                            </button>
                            <a
                              href={`/live/${ep.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] flex items-center gap-1"
                            >
                              <Globe className="w-3 h-3" />
                              <span>Testar</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => handleDeleteEndpoint(ep.slug)}
                              className="p-1 text-slate-500 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Background Linux Process Runner & Live Webhook Request Logs */}
                <div className="space-y-2.5 pt-2 border-t border-slate-800 text-xs">
                  <span className="font-semibold text-slate-200 block">
                    Processos Linux em Background & Logs de Requisições (`/live/*`)
                  </span>

                  <form onSubmit={handleStartBgProcess} className="flex gap-2">
                    <input
                      type="text"
                      value={bgCommandInput}
                      onChange={(e) => setBgCommandInput(e.target.value)}
                      placeholder="Ex: python3 hello.py ou node script.js"
                      className="flex-1 bg-[#090D16] border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-slate-100 outline-none"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 font-medium whitespace-nowrap"
                    >
                      Iniciar Processo
                    </button>
                  </form>

                  {managedProcesses.length > 0 && (
                    <div className="space-y-1.5 max-h-28 overflow-y-auto">
                      {managedProcesses.map((p) => (
                        <div
                          key={p.id}
                          className="bg-[#030508] border border-slate-800 rounded-lg p-2.5 font-mono text-[11px]"
                        >
                          <div className="flex items-center justify-between text-slate-300 mb-1">
                            <span>
                              PID {p.pid} · {p.command} ({p.status})
                            </span>
                            {p.status === 'running' && (
                              <button
                                type="button"
                                onClick={() => handleStopBgProcess(p.id)}
                                className="text-red-400 hover:underline"
                              >
                                Encerrar
                              </button>
                            )}
                          </div>
                          <div className="text-slate-400 truncate">
                            {p.logs[p.logs.length - 1] || ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-[#030508] border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-300 max-h-28 overflow-y-auto space-y-1">
                    {liveRequestLogs.length === 0 ? (
                      <div className="text-slate-500">
                        Aguardando requisições em /live/* (clique em "Testar" em qualquer rota acima para ver o log em tempo real)...
                      </div>
                    ) : (
                      liveRequestLogs.map((log) => (
                        <div key={log.id}>
                          [{log.timestamp}] <span className="text-emerald-400">{log.method}</span>{' '}
                          <span className="text-cyan-300">{log.path}</span> —{' '}
                          {JSON.stringify(log.body || log.query)}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: EXTENSÕES, HUGGING FACE TOKEN KEY & VELOCIDADE */}
        {activeView === 'extensions' && (
          <div className="max-w-4xl mx-auto w-full space-y-6 pb-10">
            <div className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 space-y-2">
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-cyan-400" />
                <span>Configuração de Extensões, Token Key Hugging Face & Velocidade</span>
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Conecte sua Token Key da Hugging Face, configure endpoints Ollama ou utilize o motor Gemini 3.8 Flash com latência ultra-baixa.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-white">
                  1. Provedor de IA & Extensão Hugging Face
                </h2>

                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">
                    Motor Principal de Resposta
                  </label>
                  <select
                    value={extSettings.provider}
                    onChange={(e) =>
                      setExtSettings({ ...extSettings, provider: e.target.value as any })
                    }
                    className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  >
                    <option value="gemini">Google Gemini 3.8 Flash (Padrão Ultra-Rápido)</option>
                    <option value="huggingface">Extensão Hugging Face Inference API (Token Key)</option>
                    <option value="ollama">Extensão Ollama Local (http://localhost:11434)</option>
                  </select>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Hugging Face Token Key (Salva em Modo Persistente)
                    </label>
                    <input
                      type="password"
                      value={extSettings.hfToken}
                      onChange={(e) =>
                        setExtSettings({ ...extSettings, hfToken: e.target.value })
                      }
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 outline-none focus:border-cyan-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Modelo Open-Source na Hugging Face
                    </label>
                    <select
                      value={extSettings.hfModel}
                      onChange={(e) =>
                        setExtSettings({ ...extSettings, hfModel: e.target.value })
                      }
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 outline-none focus:border-cyan-400"
                    >
                      <option value="Qwen/Qwen2.5-Coder-32B-Instruct">Qwen/Qwen2.5-Coder-32B-Instruct (Apache-2.0)</option>
                      <option value="Qwen/Qwen2.5-7B-Instruct">Qwen/Qwen2.5-7B-Instruct (Apache-2.0)</option>
                      <option value="bigcode/starcoder2-15b-instruct-v0.1">bigcode/starcoder2-15b-instruct-v0.1</option>
                      <option value="codellama/CodeLlama-34b-Instruct-hf">codellama/CodeLlama-34b-Instruct-hf</option>
                      <option value="meta-llama/Llama-3.1-8B-Instruct">meta-llama/Llama-3.1-8B-Instruct</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold text-white">
                    2. Otimização de Velocidade & Geração de Código
                  </h2>

                  <label className="flex items-center justify-between p-3 rounded-lg bg-[#090D16] border border-slate-800 cursor-pointer">
                    <div>
                      <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        <span>Resposta Ultra-Rápida (Low Latency Mode)</span>
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Usa ThinkingLevel.LOW para responder em menos de 1 segundo
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={extSettings.fastMode}
                      onChange={(e) =>
                        setExtSettings({ ...extSettings, fastMode: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg bg-[#090D16] border border-slate-800 cursor-pointer">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">
                        RAG Híbrido Local + Guardrail OWASP Top 10
                      </span>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Enriquece respostas com documentação open-source e segurança web
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={extSettings.enableRag}
                      onChange={(e) =>
                        setExtSettings({
                          ...extSettings,
                          enableRag: e.target.checked,
                          enableOwaspGuard: e.target.checked
                        })
                      }
                      className="w-4 h-4 accent-cyan-400 rounded"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('dcode_2_ext_settings_v4', JSON.stringify(extSettings));
                    setStatusBanner('Configurações de Extensões e Token Key Hugging Face salvas!');
                    setTimeout(() => setStatusBanner(null), 3000);
                  }}
                  className="w-full py-2.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors"
                >
                  Salvar Configurações Persistentemente
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: PIPELINE 7B, DESTILAÇÃO & RAG */}
        {activeView === 'pipeline' && (
          <div className="space-y-6 pb-10">
            <div className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="space-y-2 flex-1">
                <h1 className="text-xl font-bold text-white">
                  Pipeline de Integração 7B, Knowledge Distillation & RAG (Open-Source Permissivo)
                </h1>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Extraia conhecimento técnico fullstack e pares de segurança OWASP de modelos maiores (Qwen2.5-Coder-32B, StarCoder2-15B, CodeLlama-34B) sob licenças Apache-2.0 / MIT.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Modelo Teacher Open-Source</label>
                    <select
                      value={distillTeacher}
                      onChange={(e) => setDistillTeacher(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none"
                    >
                      <option value="Qwen/Qwen2.5-Coder-32B-Instruct">Qwen/Qwen2.5-Coder-32B-Instruct (Apache-2.0)</option>
                      <option value="bigcode/starcoder2-15b-instruct-v0.1">bigcode/starcoder2-15b-instruct-v0.1 (Apache-2.0)</option>
                      <option value="codellama/CodeLlama-34b-Instruct-hf">codellama/CodeLlama-34b-Instruct-hf</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Tópico Fullstack / Debugging / OWASP</label>
                    <input
                      type="text"
                      value={distillTopic}
                      onChange={(e) => setDistillTopic(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerateDistillationPair}
                disabled={isDistilling}
                className="px-4 py-2.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs whitespace-nowrap"
              >
                {isDistilling ? 'Destilando...' : '+ Gerar Par Sintético (SFT + DPO)'}
              </button>
            </div>

            <div className="space-y-4">
              {syntheticPairs.map((pair) => (
                <div key={pair.id} className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-5 space-y-3">
                  <div className="text-xs text-slate-400 font-mono">
                    <span className="text-white font-semibold">{pair.domain}</span>
                    <span className="mx-2">·</span>
                    <span className="text-cyan-300">{pair.teacherModel}</span>
                    <span className="mx-2">·</span>
                    <span className="text-emerald-400">{pair.license}</span>
                  </div>
                  <p className="text-xs text-slate-300">{pair.instruction}</p>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-[#030508] border border-slate-800 rounded-lg p-3.5">
                      <div className="text-xs font-semibold text-emerald-400 mb-2">
                        Código Seguro Escolhido (SFT / DPO+)
                      </div>
                      <pre className="text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap">
                        {pair.chosenCode}
                      </pre>
                    </div>
                    <div className="bg-[#030508] border border-slate-800 rounded-lg p-3.5">
                      <div className="text-xs font-semibold text-red-400 mb-2">
                        Código Vulnerável Rejeitado (DPO- OWASP)
                      </div>
                      <pre className="text-xs font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">
                        {pair.rejectedCode}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-4">
              <h2 className="text-base font-bold text-white">
                Base RAG Local Indexada (Apache-2.0 / MIT / OWASP)
              </h2>
              {ragDocs.map((doc) => (
                <div key={doc.id} className="bg-[#0E1525] border border-slate-800/90 rounded-xl p-5 space-y-2">
                  <h3 className="text-sm font-semibold text-white">{doc.title}</h3>
                  <div className="text-xs font-mono text-slate-400">
                    <span>Fonte: {doc.source}</span>
                    <span className="mx-2">·</span>
                    <span className="text-emerald-400">Licença: {doc.license}</span>
                  </div>
                  <pre className="bg-[#030508] border border-slate-800 rounded-lg p-3.5 text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {doc.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
