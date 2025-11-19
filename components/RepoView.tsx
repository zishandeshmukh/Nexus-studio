
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Code2, Play, Loader2, AlertCircle, FileCode, Github, Upload, FileText, RefreshCw, Plus, X, CheckCircle2, Search, FileSearch, Download, Copy, Check, Filter, FileWarning, Settings, ChevronDown, ChevronUp, Share2, Trash2, Layers, GitBranch, History, RotateCcw, ArrowUp, ArrowDown, PlusCircle, ScrollText, Eraser, Bot, Sparkles, ClipboardPaste, ArrowLeftRight, Mic, MicOff, Image as ImageIcon, Volume2, Zap, Scissors, GitCommit, MousePointerClick, LayoutList, Workflow, ListTodo, Map, Database, BrainCircuit, CheckSquare, Square, GripVertical } from 'lucide-react';
import { analyzeRepositoryStream, analyzeFileDeepDiveStream, streamCodeAgent, streamDiagramGenerator, streamRoadmapGenerator, RepoAnalysisConfig, CustomModule, generateSpeech } from '../services/gemini';
import { fetchGithubRepoContents, fetchGithubFile, fetchGithubCommits, FetchedFileStatus, GithubCommit } from '../services/github';
import { indexCodebase, searchCodebase, CodeChunk } from '../services/rag';
import { VoiceName, ActiveView } from '../types';

declare global {
    interface Window {
        mermaid: any;
    }
}

type InputMode = 'manual' | 'github';

const STANDARD_MODULES = [
  'Executive Summary',
  'Architecture Review',
  'Security Audit',
  'Code Quality',
  'Code Duplication Detection',
  'Performance Profile',
  'Refactoring Recommendations'
];

const COMMON_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.md', '.css', '.html'];

interface AgentMessage {
    role: 'user' | 'model';
    text: string;
    images?: string[];
    timestamp: number;
    isSpeaking?: boolean;
}

interface CodeSnippet {
    lang: string;
    code: string;
    id: string;
}

interface TaskItem {
    id: string;
    title: string;
    category: string;
    priority: 'High' | 'Medium' | 'Low';
    status: 'todo' | 'in-progress' | 'done';
}

interface Props {
    showSettings?: boolean;
    onToggleSettings?: () => void;
    activeView: ActiveView;
    onViewChange: (view: ActiveView) => void;
}

interface DiffBlock {
    search: string;
    replace: string;
    startIndex: number;
}

const RepoView: React.FC<Props> = ({ showSettings = false, onToggleSettings, activeView, onViewChange }) => {
  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [codeContext, setCodeContext] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedSnippets, setExtractedSnippets] = useState<CodeSnippet[]>([]);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState('');
  const [snippetFilterLang, setSnippetFilterLang] = useState('All');
  
  // GitHub State
  const [githubUrl, setGithubUrl] = useState('');
  const [branchInput, setBranchInput] = useState('');
  const [isFetchingRepo, setIsFetchingRepo] = useState(false);
  const [fetchStatus, setFetchStatus] = useState('');
  const [fetchProgress, setFetchProgress] = useState(0);
  const [fetchedFiles, setFetchedFiles] = useState<FetchedFileStatus[]>([]);
  const [activeRepo, setActiveRepo] = useState<{owner: string, repo: string, branch: string} | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [forceFetchAll, setForceFetchAll] = useState(false);

  // Commits State
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);

  // Diagrams State
  const [mermaidCode, setMermaidCode] = useState('');
  const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
  const [diagramType, setDiagramType] = useState<'class' | 'flow' | 'state'>('flow');
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // Roadmap State
  const [roadmapTasks, setRoadmapTasks] = useState<TaskItem[]>([]);
  const [isGeneratingRoadmap, setIsGeneratingRoadmap] = useState(false);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  // Filters
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>(['.ts', '.tsx', '.js', '.jsx', '.py']);
  const [customExtension, setCustomExtension] = useState('');
  const [maxFileSizeKB, setMaxFileSizeKB] = useState(50);

  // Settings
  const [temperature, setTemperature] = useState(0.2);
  const [activeModules, setActiveModules] = useState<string[]>(STANDARD_MODULES);
  const [customModules, setCustomModules] = useState<CustomModule[]>([]);
  const [newCustomModule, setNewCustomModule] = useState({ name: '', instruction: '' });

  // Single File Analysis State
  const [specificFilePath, setSpecificFilePath] = useState('');
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);

  // Code Agent / Chat State
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [agentImages, setAgentImages] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isFastMode, setIsFastMode] = useState(true); // Default to fast mode
  const [selectedCode, setSelectedCode] = useState('');
  const recognitionRef = useRef<any>(null);
  
  // Diff / Refactoring State
  const [pendingDiff, setPendingDiff] = useState<DiffBlock | null>(null);

  // RAG / Semantic Search State
  const [showSemanticSearch, setShowSemanticSearch] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedChunks, setIndexedChunks] = useState<CodeChunk[]>([]);
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticResults, setSemanticResults] = useState<CodeChunk[]>([]);
  const [isSearchingRAG, setIsSearchingRAG] = useState(false);

  // Upload State
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Search Context State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // README Extraction
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [hasCopiedReadme, setHasCopiedReadme] = useState(false);

  // Auto Scroll
  const outputEndRef = useRef<HTMLDivElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Draft Handling
  const [hasDraft, setHasDraft] = useState(false);

  // --- Effects ---

  // Initialize Mermaid
  useEffect(() => {
      if (window.mermaid) {
          window.mermaid.initialize({ 
              startOnLoad: false, // We manually run it
              theme: 'dark',
              securityLevel: 'loose',
          });
      }
  }, []);

  // Re-render Mermaid when code changes
  useEffect(() => {
      if (mermaidCode && activeView === 'diagrams' && window.mermaid) {
          const render = async () => {
              setDiagramError(null);
              try {
                const element = document.getElementById('mermaid-graph');
                if (element) {
                    element.removeAttribute('data-processed');
                    element.innerHTML = mermaidCode; // Reset content
                    await window.mermaid.run({ nodes: [element] });
                }
              } catch (e: any) {
                  console.error("Mermaid render failed", e);
                  const msg = e instanceof Error ? e.message : (typeof e === 'string' ? e : 'Unknown Error');
                  setDiagramError(`Diagram rendering failed: ${msg}. Try regenerating.`);
              }
          }
          // Small delay to ensure DOM is ready
          const timer = setTimeout(render, 200);
          return () => clearTimeout(timer);
      }
  }, [mermaidCode, activeView]);

  // Sync Backdrop Scroll
  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Auto-save Draft
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      if (codeContext.length > 50) {
        localStorage.setItem('nexus_repo_draft', codeContext);
      } else if (codeContext.length === 0) {
        localStorage.removeItem('nexus_repo_draft');
      }
    }, 2000);
    return () => clearTimeout(saveTimer);
  }, [codeContext]);

  // Check for Draft on Mount and URL Params
  useEffect(() => {
    const draft = localStorage.getItem('nexus_repo_draft');
    if (draft && draft.length > 0) {
      setHasDraft(true);
    }
    
    // Load custom modules from local storage
    const savedModules = localStorage.getItem('nexus_custom_modules');
    if (savedModules) {
      try {
        setCustomModules(JSON.parse(savedModules));
      } catch (e) { console.error("Failed to load custom modules", e); }
    }

    // Check for URL Params for Sharing
    const params = new URLSearchParams(window.location.search);
    const repoParam = params.get('repo');
    const fileParam = params.get('file');
    const branchParam = params.get('branch');
    
    if (repoParam) {
      setInputMode('github');
      setGithubUrl(`https://github.com/${repoParam}`);
      if (branchParam) setBranchInput(branchParam);
      
      const [owner, repo] = repoParam.split('/');
      if (owner && repo) {
        // Optimistically set active repo
        setActiveRepo({ owner, repo, branch: branchParam || 'main' }); 
      }

      if (fileParam) {
        setSpecificFilePath(fileParam);
      }
    }
  }, []);

  // Extract README & Snippets & Stabilized Auto Scroll
  useEffect(() => {
    // 1. Stabilized Auto Scroll
    if (autoScroll && outputContainerRef.current) {
        const container = outputContainerRef.current;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 300;
        
        if (isNearBottom || analysis.length < 500 || agentMessages.length < 2) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // 2. Extract README
    if (activeView === 'report' || activeView === 'readme') {
        const match = analysis.match(/```markdown\s+([\s\S]*?)\s+```/g);
        if (match && match.length > 0) {
            const block = match[match.length - 1];
            const content = block.replace(/^```markdown\s+/, '').replace(/\s+```$/, '');
            if (content.includes('#')) {
                setReadmeContent(content);
            }
        }
    }
    
    // 3. Extract Code Snippets
    if (!isAnalyzing && analysis) {
        const regex = /```(\w+)?\s*([\s\S]*?)```/g;
        const snippets: CodeSnippet[] = [];
        let match;
        let idx = 0;
        while ((match = regex.exec(analysis)) !== null) {
            const lang = match[1] || 'text';
            const code = match[2].trim();
            if (lang !== 'markdown') {
                snippets.push({ lang, code, id: `snip-${idx++}` });
            }
        }
        setExtractedSnippets(snippets);
    }

  }, [analysis, agentMessages, autoScroll, isAnalyzing, isAnalyzingFile, isAgentThinking, activeView]);

  // Search Logic
  useEffect(() => {
    if (!searchTerm || !codeContext) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const matches: number[] = [];
    let pos = codeContext.toLowerCase().indexOf(searchTerm.toLowerCase());
    while (pos !== -1) {
      matches.push(pos);
      pos = codeContext.toLowerCase().indexOf(searchTerm.toLowerCase(), pos + 1);
    }
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
      scrollToMatch(matches[0]);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [searchTerm, codeContext]);

  // Web Speech API Setup
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const speechRecognition = new (window as any).webkitSpeechRecognition();
      speechRecognition.continuous = true;
      speechRecognition.interimResults = true;
      
      speechRecognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setAgentPrompt(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      speechRecognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = speechRecognition;
    }
  }, []);

  // --- Handlers ---

  const handleTextSelect = () => {
      if (textareaRef.current) {
          const start = textareaRef.current.selectionStart;
          const end = textareaRef.current.selectionEnd;
          if (start !== end) {
              const selected = codeContext.substring(start, end);
              setSelectedCode(selected);
          } else {
              setSelectedCode('');
          }
      }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) {
        alert("Speech recognition is not supported in this browser.");
        return;
    }
    if (isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
    } else {
        recognitionRef.current.start();
        setIsListening(true);
    }
  };

  const handlePlaySpeech = async (text: string, index: number) => {
      try {
          // Clean code blocks and markdown symbols
          let cleanText = text.replace(/```[\s\S]*?```/g, " Code block omitted. ");
          cleanText = cleanText.replace(/[#*`_~]/g, ""); // Remove common markdown symbols

          if (!cleanText.trim()) {
             alert("No readable text found to speak.");
             return;
          }

          setAgentMessages(prev => prev.map((msg, i) => i === index ? { ...msg, isSpeaking: true } : msg));
          
          const audioBuffer = await generateSpeech(cleanText, VoiceName.Kore);
          
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const buffer = await ctx.decodeAudioData(audioBuffer);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          
          source.onended = () => {
             setAgentMessages(prev => prev.map((msg, i) => i === index ? { ...msg, isSpeaking: false } : msg));
          };
      } catch (e: any) {
          console.error("Speech failed", e);
          alert(`Speech Generation Error: ${e.message || "Check console for details."}`);
          setAgentMessages(prev => prev.map((msg, i) => i === index ? { ...msg, isSpeaking: false } : msg));
      }
  };

  const scrollToMatch = (index: number) => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(index, index + searchTerm.length);
      // Approximate scroll
      const textBefore = codeContext.substring(0, index);
      const lines = textBefore.split('\n').length;
      const lineHeight = 20; // approximate
      const top = lines * lineHeight - (textareaRef.current.clientHeight / 2);
      textareaRef.current.scrollTop = top > 0 ? top : 0;
    }
  };

  const handleSearchNav = (direction: 'next' | 'prev') => {
    if (searchMatches.length === 0) return;
    
    let newIndex = direction === 'next' ? currentMatchIndex + 1 : currentMatchIndex - 1;
    
    if (newIndex >= searchMatches.length) newIndex = 0;
    if (newIndex < 0) newIndex = searchMatches.length - 1;
    
    setCurrentMatchIndex(newIndex);
    scrollToMatch(searchMatches[newIndex]);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  };

  const restoreDraft = () => {
    const draft = localStorage.getItem('nexus_repo_draft');
    if (draft) {
      setCodeContext(draft);
      setHasDraft(false);
    }
  };

  const discardDraft = () => {
    localStorage.removeItem('nexus_repo_draft');
    setHasDraft(false);
  };

  const resetSettings = () => {
    setTemperature(0.2);
    setActiveModules(STANDARD_MODULES);
    setMaxFileSizeKB(50);
  };

  const handleAnalyze = async () => {
    if (!codeContext.trim() || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalysis('');
    setReadmeContent(null);
    onViewChange('report');
    setAutoScroll(true);
    setExtractedSnippets([]);

    const config: RepoAnalysisConfig = {
      temperature,
      modules: activeModules,
      customModules
    };

    try {
      const stream = analyzeRepositoryStream(codeContext, config);
      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        setAnalysis(fullText);
      }
    } catch (error) {
      console.error("Analysis failed", error);
      setAnalysis("**Error:** Failed to analyze repository content. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateDiagram = async () => {
      if (!codeContext) return;
      setIsGeneratingDiagram(true);
      setMermaidCode('');
      setDiagramError(null);
      try {
          const stream = streamDiagramGenerator(codeContext, diagramType);
          let fullResponse = '';
          for await (const chunk of stream) {
              fullResponse += chunk;
          }
          
          // Robust Extraction
          let code = '';
          // 1. Try to find markdown block
          const codeBlockRegex = /```(?:mermaid)?\s*([\s\S]*?)```/i;
          const match = codeBlockRegex.exec(fullResponse);
          
          if (match && match[1]) {
              code = match[1].trim();
          } else {
              // 2. Fallback: assume raw code but try to strip conversational prefixes
              // Mermaid diagrams start with specific keywords usually
              const patterns = ['graph', 'flowchart', 'classDiagram', 'stateDiagram', 'erDiagram', 'sequenceDiagram', 'gantt', 'pie'];
              const lines = fullResponse.split('\n');
              const startIndex = lines.findIndex(line => patterns.some(p => line.trim().startsWith(p)));
              
              if (startIndex !== -1) {
                  code = lines.slice(startIndex).join('\n').trim();
              } else {
                  // Last resort: just clean markdown tags
                  code = fullResponse.replace(/```mermaid/gi, '').replace(/```/g, '').trim();
              }
          }
          
          if (!code) throw new Error("No diagram code generated");
          setMermaidCode(code);
      } catch (e: any) {
          console.error(e);
          setDiagramError(e.message);
      } finally {
          setIsGeneratingDiagram(false);
      }
  };

  const handleGenerateRoadmap = async () => {
      if (!analysis) return;
      setIsGeneratingRoadmap(true);
      setRoadmapTasks([]);
      try {
          const stream = streamRoadmapGenerator(analysis);
          let jsonStr = '';
          for await (const chunk of stream) {
              jsonStr += chunk;
          }
          
          // Sanitization: remove markdown block if present
          jsonStr = jsonStr.trim();
          if (jsonStr.startsWith('```json')) {
             jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
          } else if (jsonStr.startsWith('```')) {
             jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
          }

          const tasks = JSON.parse(jsonStr);
          setRoadmapTasks(tasks);
      } catch (e) {
          console.error(e);
      } finally {
          setIsGeneratingRoadmap(false);
      }
  };

  // --- RAG Handlers ---
  const handleIndexCodebase = async () => {
      if (!codeContext) return;
      setIsIndexing(true);
      try {
          const chunks = await indexCodebase(codeContext, (curr, total) => {
             setFetchStatus(`Indexing semantic vectors: ${curr}/${total} chunks...`);
          });
          setIndexedChunks(chunks);
          setFetchStatus("Semantic Index Ready.");
      } catch (e) {
          console.error("Indexing failed", e);
      } finally {
          setIsIndexing(false);
      }
  };

  const handleSemanticSearch = async () => {
      if (!semanticQuery || indexedChunks.length === 0) return;
      setIsSearchingRAG(true);
      try {
          const results = await searchCodebase(semanticQuery, indexedChunks, 4);
          setSemanticResults(results);
      } catch (e) {
          console.error(e);
      } finally {
          setIsSearchingRAG(false);
      }
  };

  const handleAgentPrompt = async () => {
    if (!agentPrompt.trim() && agentImages.length === 0) return;
    if (isAgentThinking || !codeContext.trim()) {
        if (!codeContext.trim()) alert("Please load some code context first.");
        return;
    }
    
    const newUserMsg: AgentMessage = { role: 'user', text: agentPrompt, images: agentImages, timestamp: Date.now() };
    setAgentMessages(prev => [...prev, newUserMsg]);
    
    const currentPrompt = agentPrompt;
    const currentImages = agentImages;
    setAgentPrompt('');
    setAgentImages([]);
    setIsAgentThinking(true);
    setAutoScroll(true);

    // Create placeholder for bot
    const botMsgId = Date.now();
    setAgentMessages(prev => [...prev, { role: 'model', text: '', timestamp: botMsgId }]);
    
    try {
      // Filter history to simple text/role for the service, excluding current
      const historyForService = agentMessages.map(m => ({ role: m.role, text: m.text, images: m.images }));
      
      const stream = streamCodeAgent(codeContext, historyForService, currentPrompt, currentImages, { isFastMode, selectedCode });
      let fullText = '';
      
      for await (const chunk of stream) {
        fullText += chunk;
        setAgentMessages(prev => prev.map(m => m.timestamp === botMsgId ? { ...m, text: fullText } : m));
      }
    } catch (error) {
        setAgentMessages(prev => prev.map(m => m.timestamp === botMsgId ? { ...m, text: "**Error:** Agent failed to respond." } : m));
    } finally {
      setIsAgentThinking(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                  setAgentImages(prev => [...prev, reader.result as string]);
              }
          };
          reader.readAsDataURL(file);
      }
  };

  // Diff / Patch Parsing
  const checkAndApplyDiff = (text: string) => {
      const searchRegex = /<<<<<<< SEARCH\s+([\s\S]*?)\s+=======\s+([\s\S]*?)\s+>>>>>>>/;
      const match = searchRegex.exec(text);
      
      if (match) {
          const searchBlock = match[1].trim();
          const replaceBlock = match[2].trim();
          
          // Find index in current code
          const idx = codeContext.indexOf(searchBlock);
          if (idx !== -1) {
              setPendingDiff({
                  search: searchBlock,
                  replace: replaceBlock,
                  startIndex: idx
              });
          } else {
              alert("Could not find exact match for the SEARCH block in the current code. Please try 'Replace All' or manual edit.");
          }
      } else {
          applyAgentCode(text, 'replace');
      }
  };

  const confirmDiffApply = () => {
      if (pendingDiff) {
          const before = codeContext.substring(0, pendingDiff.startIndex);
          const after = codeContext.substring(pendingDiff.startIndex + pendingDiff.search.length);
          setCodeContext(before + pendingDiff.replace + after);
          setPendingDiff(null);
          alert("Patch applied successfully!");
      }
  };

  const applyAgentCode = (text: string, mode: 'append' | 'replace') => {
     if (mode === 'replace') {
         if (text.includes("<<<<<<< SEARCH")) {
             checkAndApplyDiff(text);
             return;
         }
     }

     const regex = /```(?:\w+)?\s*([\s\S]*?)\s*```/g;
     let match;
     let codeToApply = '';
     let count = 0;
     
     while ((match = regex.exec(text)) !== null) {
       codeToApply += match[1] + '\n\n';
       count++;
     }
     
     codeToApply = codeToApply.trim();
     
     if (!codeToApply) {
       if (window.confirm("No code blocks detected. Use entire message text?")) {
           codeToApply = text;
       } else {
           return;
       }
     }
     
     if (mode === 'replace') {
       if (window.confirm(`Replace entire editor content with ${count > 0 ? count : 'new'} code block(s)?`)) {
         setCodeContext(codeToApply);
       }
     } else {
       setCodeContext(prev => prev + "\n\n" + codeToApply);
       setTimeout(() => {
           if (textareaRef.current) textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
       }, 100);
     }
  };

  const handleGithubFetch = async (useForceAll: boolean) => {
    if (!githubUrl.trim()) return;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    setIsFetchingRepo(true);
    setFetchStatus("Initializing...");
    setFetchProgress(0);
    setFetchedFiles([]);
    setActiveRepo(null);
    setCommits([]);
    
    try {
      const updateProgress = (status: string) => setFetchStatus(status);
      const updateFile = (file: FetchedFileStatus) => {
        setFetchedFiles(prev => {
          const exists = prev.find(f => f.path === file.path);
          if (exists) {
            return prev.map(f => f.path === file.path ? file : f);
          }
          return [...prev, file];
        });
        if (file.status === 'success') {
             setFetchProgress(old => Math.min(old + 2.5, 95));
        }
      };

      const extensions = [...selectedExtensions];
      if (customExtension) extensions.push(customExtension.startsWith('.') ? customExtension : `.${customExtension}`);

      const { content, repoDetails } = await fetchGithubRepoContents(
        githubUrl, 
        updateProgress, 
        updateFile,
        extensions,
        abortController.signal,
        { 
          fetchAll: useForceAll, 
          branch: branchInput,
          maxFileSize: useForceAll ? undefined : maxFileSizeKB * 1024
        }
      );

      setCodeContext(content);
      setActiveRepo(repoDetails);
      if (!branchInput) setBranchInput(repoDetails.branch);
      setGithubUrl(`https://github.com/${repoDetails.owner}/${repoDetails.repo}`);
      setFetchStatus(useForceAll ? 'Full repository loaded!' : 'Repository loaded (filtered).');
      setFetchProgress(100);
      
      fetchCommitsForRepo(repoDetails.owner, repoDetails.repo, repoDetails.branch);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        setFetchStatus('Fetch cancelled by user.');
      } else {
        setFetchStatus(`Error: ${error.message}`);
      }
      setFetchProgress(0);
    } finally {
      setIsFetchingRepo(false);
      abortControllerRef.current = null;
    }
  };

  const fetchCommitsForRepo = async (owner: string, repo: string, branch: string) => {
    setIsLoadingCommits(true);
    try {
      const data = await fetchGithubCommits(owner, repo, branch);
      setCommits(data);
    } catch (error) {
      console.error("Failed to fetch commits", error);
    } finally {
      setIsLoadingCommits(false);
    }
  };

  const cancelFetch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleAnalyzeFile = async () => {
    if (!activeRepo || !specificFilePath.trim()) return;

    setIsAnalyzingFile(true);
    setAnalysis('');
    setReadmeContent(null);
    onViewChange('report');
    setAutoScroll(true);

    try {
      const fileContent = await fetchGithubFile(activeRepo.owner, activeRepo.repo, activeRepo.branch, specificFilePath.trim());
      const stream = analyzeFileDeepDiveStream(fileContent, specificFilePath);
      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        setAnalysis(fullText);
      }
    } catch (error: any) {
      console.error("File Analysis failed", error);
      setAnalysis(`**Error:** Failed to analyze file '${specificFilePath}'. \nReason: ${error.message}`);
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  const copyShareLink = () => {
    if (!activeRepo || !specificFilePath) return;
    const url = new URL(window.location.href);
    url.searchParams.set('repo', `${activeRepo.owner}/${activeRepo.repo}`);
    url.searchParams.set('file', specificFilePath);
    if (activeRepo.branch && activeRepo.branch !== 'main') {
      url.searchParams.set('branch', activeRepo.branch);
    }
    navigator.clipboard.writeText(url.toString());
    alert("Shareable link copied to clipboard!");
  };

  const toggleExtension = (ext: string) => {
    setSelectedExtensions(prev => 
      prev.includes(ext) ? prev.filter(e => e !== ext) : [...prev, ext]
    );
  };

  const toggleModule = (mod: string) => {
    setActiveModules(prev => 
      prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]
    );
  };

  const addCustomModule = () => {
    if (newCustomModule.name && newCustomModule.instruction) {
        const id = `custom-${Date.now()}`;
        const module: CustomModule = { id, ...newCustomModule };
        const updated = [...customModules, module];
        setCustomModules(updated);
        localStorage.setItem('nexus_custom_modules', JSON.stringify(updated));
        setActiveModules([...activeModules, id]);
        setNewCustomModule({ name: '', instruction: '' });
    }
  };

  const removeCustomModule = (id: string) => {
    const updated = customModules.filter(m => m.id !== id);
    setCustomModules(updated);
    localStorage.setItem('nexus_custom_modules', JSON.stringify(updated));
    setActiveModules(activeModules.filter(m => m !== id));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      let newContent = "";
      const currentErrors: string[] = [];
      
      for (const file of files) {
        try {
          const text = await file.text();
          const path = file.webkitRelativePath || file.name;
          newContent += `--- FILE: ${path} ---\n${text}\n--- END OF FILE ---\n\n`;
        } catch (err) {
          currentErrors.push(file.name);
        }
      }
      
      if (newContent) {
        setCodeContext(prev => prev + (prev ? "\n\n" : "") + newContent);
      }
      
      setUploadErrors(currentErrors);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveReport = () => {
    if (!analysis) return;
    const blob = new Blob([analysis], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repo-analysis-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveDiagram = () => {
      if (!mermaidCode) return;
      const blob = new Blob([mermaidCode], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagram-${diagramType}.mmd`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleCopyReadme = () => {
    if (readmeContent) {
      navigator.clipboard.writeText(readmeContent);
      setHasCopiedReadme(true);
      setTimeout(() => setHasCopiedReadme(false), 2000);
    }
  };

  const clearInput = () => {
    if (window.confirm("Are you sure you want to clear all context and analysis?")) {
      setCodeContext('');
      setAnalysis('');
      setReadmeContent(null);
      setFetchStatus('');
      setFetchProgress(0);
      setActiveRepo(null);
      setCommits([]);
      setSpecificFilePath('');
      setUploadErrors([]);
      setFetchedFiles([]);
      setAgentMessages([]);
      setAgentPrompt('');
      setMermaidCode('');
      setRoadmapTasks([]);
      setIndexedChunks([]);
      localStorage.removeItem('nexus_repo_draft');
      setHasDraft(false);
    }
  };

  const clearOutput = () => {
    if (activeView === 'agent') {
        setAgentMessages([]);
    } else {
        setAnalysis('');
        setReadmeContent(null);
        setExtractedSnippets([]);
        setMermaidCode('');
        setRoadmapTasks([]);
    }
  };

  // Roadmap Drag and Drop
  const onDragStart = (e: React.DragEvent, taskId: string) => {
      setDraggedTask(taskId);
      e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (e: React.DragEvent, status: 'todo' | 'in-progress' | 'done') => {
      e.preventDefault();
      if (draggedTask) {
          setRoadmapTasks(prev => prev.map(t => t.id === draggedTask ? { ...t, status } : t));
          setDraggedTask(null);
      }
  };
  
  const renderBackdrop = () => {
    if (!searchTerm || !codeContext) return null;
    const escapeHtml = (unsafe: string) => {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };
    const lowerContext = codeContext.toLowerCase();
    const lowerTerm = searchTerm.toLowerCase();
    let result = '';
    let lastIndex = 0;
    let matchIndex = lowerContext.indexOf(lowerTerm);
    if (matchIndex === -1) return null;
    while (matchIndex !== -1) {
        result += escapeHtml(codeContext.substring(lastIndex, matchIndex));
        result += `<mark class="bg-indigo-500/40 text-transparent rounded-sm box-decoration-clone">${escapeHtml(codeContext.substring(matchIndex, matchIndex + lowerTerm.length))}</mark>`;
        lastIndex = matchIndex + lowerTerm.length;
        matchIndex = lowerContext.indexOf(lowerTerm, lastIndex);
    }
    result += escapeHtml(codeContext.substring(lastIndex));
    if (codeContext.endsWith('\n')) {
        result += '<br/>'; 
    }
    return <div 
       ref={backdropRef}
       className="absolute inset-0 p-4 font-mono text-xs md:text-sm whitespace-pre-wrap break-words pointer-events-none text-transparent overflow-hidden z-0 leading-relaxed"
       dangerouslySetInnerHTML={{ __html: result }}
    />
  };

  const filteredSnippets = extractedSnippets.filter(snip => {
      const matchSearch = snip.code.toLowerCase().includes(snippetSearch.toLowerCase()) || snip.lang.includes(snippetSearch.toLowerCase());
      const matchLang = snippetFilterLang === 'All' || snip.lang.toLowerCase() === snippetFilterLang.toLowerCase();
      return matchSearch && matchLang;
  });

  const uniqueLangs = Array.from(new Set(extractedSnippets.map(s => s.lang)));

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      {/* Main Header */}
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm sticky top-0 z-50 flex flex-col md:flex-row md:justify-between md:items-center gap-4 shadow-md">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Code2 className="text-indigo-500" /> Nexus Studio
          </h2>
          <p className="text-xs text-slate-400">Gemini 3.0 Pro &middot; Multi-modal Architect Agent</p>
        </div>
        {/* ... Header actions ... */}
        <div className="flex items-center gap-3">
           {hasDraft && !codeContext && (
             <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-indigo-900/30 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 mr-2 animate-in fade-in">
               <span>Unsaved draft found</span>
               <button onClick={restoreDraft} className="underline hover:text-white">Restore</button>
               <span className="text-slate-600">|</span>
               <button onClick={discardDraft} className="hover:text-red-300 underline">Discard</button>
             </div>
           )}

           {codeContext && (
            <button 
              onClick={clearInput}
              className="text-slate-400 hover:text-red-400 text-sm font-medium transition-colors px-3"
              title="Clear Context"
            >
              <Trash2 size={18} />
            </button>
          )}
          
          {/* Semantic Search Toggle */}
          <button
            onClick={() => setShowSemanticSearch(!showSemanticSearch)}
            disabled={!codeContext}
            className={`p-2 rounded-lg border transition-all hidden md:flex ${showSemanticSearch ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
            title="Semantic Search (RAG)"
          >
            <BrainCircuit size={20} />
          </button>

          {onToggleSettings && (
              <button
                onClick={onToggleSettings}
                className={`p-2 rounded-lg border transition-all md:hidden ${showSettings ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                <Settings size={20} />
              </button>
          )}
          
          {(analysis || agentMessages.length > 0) && (
             <button 
               onClick={clearOutput} 
               className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-red-400/50"
               title="Clear Current Output"
             >
               <Eraser className="w-4 h-4" />
               <span className="hidden md:inline">Clear Output</span>
             </button>
          )}

          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !codeContext.trim()}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all shadow-lg ${
              isAnalyzing || !codeContext.trim()
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-indigo-600/20'
            }`}
          >
            {isAnalyzing ? <Loader2 className="animate-spin w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            {isAnalyzing ? 'Thinking...' : 'Audit'}
          </button>
        </div>
      </header>

      {/* Collapsible Settings Panel */}
      {showSettings && (
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 animate-in slide-in-from-top-2 z-40 relative">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">Standard Modules</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                {STANDARD_MODULES.map(mod => (
                  <button
                    key={mod}
                    onClick={() => toggleModule(mod)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-all border text-left ${
                      activeModules.includes(mod) 
                        ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300' 
                        : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full border flex-shrink-0 ${activeModules.includes(mod) ? 'bg-indigo-500 border-indigo-400' : 'border-slate-600'}`} />
                    {mod}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col h-full">
              <div className="mb-4">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 block">
                  Model Temperature: {temperature}
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.1" 
                  value={temperature} 
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
              
              <div className="mt-auto flex justify-end">
                <button 
                  onClick={resetSettings}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <RotateCcw size={12} /> Reset to Default
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Input Pane */}
        <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col bg-slate-925 relative">
           {/* (Same as before...) */}
           {/* Semantic Search Modal/Overlay */}
          {showSemanticSearch && (
            <div className="absolute top-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur p-4 border-b border-indigo-500/50 shadow-xl animate-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-indigo-400 font-medium flex items-center gap-2"><BrainCircuit size={16}/> Semantic Search (RAG)</h3>
                    <button onClick={() => setShowSemanticSearch(false)}><X size={16} className="text-slate-500 hover:text-white"/></button>
                </div>
                
                <div className="flex gap-2 mb-3">
                    <input 
                        type="text" 
                        value={semanticQuery}
                        onChange={(e) => setSemanticQuery(e.target.value)}
                        placeholder="Ask a question (e.g., 'Where is the login logic?')"
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm focus:border-indigo-500 outline-none"
                        onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
                    />
                    <button 
                        onClick={handleSemanticSearch}
                        disabled={isSearchingRAG || indexedChunks.length === 0}
                        className="px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium disabled:opacity-50"
                    >
                        {isSearchingRAG ? <Loader2 className="animate-spin"/> : <Search size={16}/>}
                    </button>
                </div>

                {indexedChunks.length === 0 ? (
                    <div className="text-center py-4 border border-dashed border-slate-700 rounded">
                        <p className="text-slate-500 text-xs mb-2">Codebase index not generated yet.</p>
                        <button 
                            onClick={handleIndexCodebase}
                            disabled={isIndexing}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-400 rounded text-xs border border-slate-700"
                        >
                            {isIndexing ? <Loader2 size={12} className="animate-spin inline mr-1"/> : <Database size={12} className="inline mr-1"/>}
                            Generate Vectors
                        </button>
                    </div>
                ) : (
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {semanticResults.map((res, i) => (
                            <div key={i} className="bg-slate-950 p-2 rounded border border-slate-800 hover:border-indigo-500/50 cursor-pointer" onClick={() => {
                                // Simple implementation: Just paste into search bar to jump
                                setSearchTerm(res.content.substring(0, 20));
                            }}>
                                <div className="flex justify-between text-xs text-slate-500 mb-1">
                                    <span>{res.fileName}</span>
                                </div>
                                <div className="text-xs font-mono text-slate-300 line-clamp-2">{res.content}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          )}

          {/* Input Tabs */}
          <div className="flex border-b border-slate-800 z-20 bg-slate-950">
            <button
              onClick={() => setInputMode('manual')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                inputMode === 'manual' 
                  ? 'text-indigo-400 border-b-2 border-indigo-500 bg-slate-900' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <FileText size={16} /> Paste / Upload
            </button>
            <button
              onClick={() => setInputMode('github')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                inputMode === 'github' 
                  ? 'text-indigo-400 border-b-2 border-indigo-500 bg-slate-900' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Github size={16} /> GitHub Repo
            </button>
          </div>

          {/* Toolbar / Actions */}
          <div className="p-4 bg-slate-900 border-b border-slate-800">
            {inputMode === 'manual' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors border border-slate-700"
                  >
                    <Upload size={16} /> Upload Files
                  </button>
                  <span className="text-xs text-slate-500">Supports multi-select & folders.</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    type="text"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 min-w-[200px] bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg px-2 w-32">
                     <GitBranch size={14} className="text-slate-500 mr-2" />
                     <input
                        type="text"
                        value={branchInput}
                        onChange={(e) => setBranchInput(e.target.value)}
                        placeholder="main"
                        className="w-full bg-transparent text-sm text-slate-200 focus:outline-none"
                        title="Branch name (optional)"
                     />
                  </div>
                  {isFetchingRepo ? (
                    <button
                      onClick={cancelFetch}
                      className="px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-lg text-sm font-medium border border-red-900/50 flex items-center gap-2 min-w-[80px] justify-center"
                    >
                      <X size={16} /> Stop
                    </button>
                  ) : (
                    <div className="flex gap-1">
                       <button
                        onClick={() => handleGithubFetch(forceFetchAll)}
                        disabled={!githubUrl}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-sm font-medium border border-slate-700 flex items-center gap-2 justify-center"
                        title={forceFetchAll ? "Fetch ALL files (Warning: Large Payload)" : "Fetch filtered files"}
                      >
                        <RefreshCw size={16} /> {forceFetchAll ? 'Fetch All' : 'Fetch'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-1">
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            id="forceFetchAll" 
                            checked={forceFetchAll} 
                            onChange={e => setForceFetchAll(e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                        />
                        <label htmlFor="forceFetchAll" className="text-xs text-slate-400 select-none cursor-pointer">
                            Force Fetch All
                        </label>
                    </div>
                    
                    {!forceFetchAll && (
                       <div className="flex items-center gap-2 flex-1">
                         <label className="text-xs text-slate-500 whitespace-nowrap">Max size: {maxFileSizeKB}KB</label>
                         <input 
                            type="range" 
                            min="10" 
                            max="500" 
                            step="10" 
                            value={maxFileSizeKB} 
                            onChange={(e) => setMaxFileSizeKB(parseInt(e.target.value))}
                            className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-slate-500"
                         />
                       </div>
                    )}
                </div>

                {/* Visual Progress Bar */}
                {(isFetchingRepo || fetchProgress > 0) && (
                  <div className="w-full">
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ease-out ${fetchStatus.startsWith('Error') ? 'bg-red-500' : 'bg-indigo-500'}`} 
                        style={{ width: `${fetchProgress}%` }} 
                      />
                    </div>
                  </div>
                )}

                {/* Status Text & List */}
                {(fetchStatus) && (
                  <div className="space-y-2 pt-2 border-t border-slate-800 mt-1">
                     <div className="flex items-center justify-between text-xs">
                        <span className={`${fetchStatus.startsWith('Error') || fetchStatus.includes('cancelled') ? 'text-red-400' : 'text-indigo-300'} flex items-center gap-1 font-medium`}>
                          {fetchStatus.startsWith('Error') ? <AlertCircle size={12}/> : isFetchingRepo ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle2 size={12}/>}
                          {fetchStatus}
                        </span>
                     </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative flex-1 group bg-slate-950">
            {/* Search Bar for Textarea */}
            <div className="absolute top-2 right-4 z-20 flex items-center bg-slate-900/90 border border-slate-700 rounded-lg p-1 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
               <Search size={14} className="text-slate-500 ml-2 mr-2" />
               <input 
                 type="text" 
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 placeholder="Find..."
                 className="w-24 bg-transparent text-xs text-slate-200 focus:outline-none"
               />
               {searchTerm && (
                 <button onClick={clearSearch} className="p-0.5 text-slate-500 hover:text-red-400 mr-1">
                    <X size={12} />
                 </button>
               )}
               {searchMatches.length > 0 && (
                 <span className="text-[10px] text-slate-500 mx-2 w-12 text-center">
                   {currentMatchIndex + 1} / {searchMatches.length}
                 </span>
               )}
               <div className="h-4 w-px bg-slate-700 mx-1" />
               <button onClick={() => handleSearchNav('prev')} className="p-1 hover:text-white text-slate-400"><ArrowUp size={12} /></button>
               <button onClick={() => handleSearchNav('next')} className="p-1 hover:text-white text-slate-400"><ArrowDown size={12} /></button>
            </div>
            
            {/* Highlight Layer (Backdrop) */}
            {renderBackdrop()}

            <textarea
              ref={textareaRef}
              value={codeContext}
              onChange={(e) => setCodeContext(e.target.value)}
              onSelect={handleTextSelect}
              onScroll={handleScroll}
              placeholder={inputMode === 'manual' 
                ? "Paste code, drag & drop files, or use the Upload button..." 
                : "Repository content will appear here automatically after successful fetch..."}
              className="absolute inset-0 w-full h-full bg-transparent p-4 font-mono text-xs md:text-sm text-slate-300 focus:outline-none resize-none placeholder:text-slate-600 leading-relaxed z-10"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Output Pane */}
        <div className="w-full md:w-1/2 flex flex-col bg-slate-950 border-t md:border-t-0 md:border-l border-slate-800 relative">
           
           {/* FIXED TOOL HEADER: Hoisted out of scroll area for stability */}
           {activeView === 'diagrams' && (
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur flex justify-between items-center shrink-0 sticky top-0 z-20">
                 <h3 className="text-lg font-semibold text-indigo-400 flex items-center gap-2"><Workflow size={20}/> Architecture Diagrams</h3>
                 <div className="flex gap-2">
                     <select 
                         value={diagramType}
                         onChange={(e) => setDiagramType(e.target.value as any)}
                         className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-300"
                     >
                         <option value="flow">Flowchart</option>
                         <option value="class">Class Diagram</option>
                         <option value="state">State Diagram</option>
                     </select>
                     <button
                         onClick={handleGenerateDiagram}
                         disabled={isGeneratingDiagram}
                         className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors flex items-center gap-2"
                     >
                         {isGeneratingDiagram ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
                         Generate
                     </button>
                     {mermaidCode && (
                       <button
                         onClick={handleSaveDiagram}
                         className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors flex items-center gap-2"
                       >
                         <Download size={14}/> Save
                       </button>
                     )}
                 </div>
             </div>
           )}

           {activeView === 'roadmap' && (
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur flex justify-between items-center shrink-0 sticky top-0 z-20">
                  <h3 className="text-lg font-semibold text-indigo-400 flex items-center gap-2"><Map size={20}/> Project Roadmap</h3>
                  <button
                      onClick={handleGenerateRoadmap}
                      disabled={isGeneratingRoadmap}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors flex items-center gap-2"
                  >
                      {isGeneratingRoadmap ? <Loader2 size={14} className="animate-spin"/> : <ListTodo size={14}/>}
                      Generate Tasks
                  </button>
              </div>
           )}

           {activeView === 'commits' && (
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur flex justify-between items-center shrink-0 sticky top-0 z-20">
                   <h3 className="text-lg font-semibold text-indigo-400 flex items-center gap-2"><GitCommit size={20}/> Repository Timeline</h3>
                   <div className="flex gap-2">
                     <span className="text-xs text-slate-500">
                        Branch: {activeRepo?.branch || 'main'}
                     </span>
                     <button 
                        onClick={() => {
                            if(activeRepo) fetchCommitsForRepo(activeRepo.owner, activeRepo.repo, activeRepo.branch);
                        }} 
                        className="p-1 hover:bg-slate-800 rounded"
                        title="Refresh Commits"
                     >
                         <RefreshCw size={14} className={isLoadingCommits ? "animate-spin" : ""} />
                     </button>
                   </div>
              </div>
           )}

           {/* Smart Diff Modal/Overlay */}
           {pendingDiff && (
                <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm p-6 flex flex-col animate-in fade-in">
                    <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-4">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <GitBranch size={20} className="text-amber-500"/> Review Smart Diff
                        </h3>
                        <button onClick={() => setPendingDiff(null)}><X size={20} className="text-slate-500 hover:text-white"/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto font-mono text-xs grid grid-cols-2 gap-4">
                        <div className="border border-red-900/30 bg-red-900/10 p-4 rounded-lg overflow-auto">
                            <div className="text-red-400 mb-2 font-bold sticky top-0">ORIGINAL</div>
                            <pre className="whitespace-pre-wrap text-red-200">{pendingDiff.search}</pre>
                        </div>
                        <div className="border border-emerald-900/30 bg-emerald-900/10 p-4 rounded-lg overflow-auto">
                             <div className="text-emerald-400 mb-2 font-bold sticky top-0">NEW</div>
                             <pre className="whitespace-pre-wrap text-emerald-200">{pendingDiff.replace}</pre>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end gap-3">
                        <button onClick={() => setPendingDiff(null)} className="px-4 py-2 text-slate-400 hover:text-white font-medium">Cancel</button>
                        <button onClick={confirmDiffApply} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium shadow-lg">Apply Patch</button>
                    </div>
                </div>
           )}

          <div 
            ref={outputContainerRef}
            className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent relative pb-32 scroll-smooth"
          >
            <div className="p-6 prose prose-invert prose-sm max-w-none">
                {/* Initial Empty State */}
                {!analysis && !isAnalyzing && !isAnalyzingFile && agentMessages.length === 0 && !isAgentThinking && activeView !== 'commits' && activeView !== 'diagrams' && (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 space-y-4 py-12">
                    <div className="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                    {activeView === 'agent' ? <Bot className="w-10 h-10"/> : <Code2 className="w-10 h-10" />}
                    </div>
                    <div className="text-center">
                        <p className="font-medium text-lg text-slate-400">Ready to Audit</p>
                        <p className="text-sm">Import files or paste code to generate<br/>report and diagrams.</p>
                    </div>
                </div>
                )}
                
                {/* Loading States */}
                {(isAnalyzing || isAnalyzingFile || isAgentThinking) && (!analysis && agentMessages.length === 0) && (
                <div className="h-full flex flex-col items-center justify-center space-y-4 py-12">
                    <Loader2 className={`w-10 h-10 animate-spin ${activeView === 'agent' ? 'text-emerald-500' : 'text-indigo-500'}`} />
                    <p className="text-slate-400 animate-pulse">
                        {isAgentThinking ? "Agent is thinking..." : isAnalyzingFile ? "Analyzing specific file..." : "Auditing repository..."}
                    </p>
                </div>
                )}

                {/* REPORT VIEW */}
                {activeView === 'report' && analysis && (
                  <div className="flex gap-6 relative">
                    <div className={`flex-1 transition-all duration-300 ${showSnippets ? 'pr-0' : ''}`}>
                        {extractedSnippets.length > 0 && (
                             <div className="sticky top-0 float-right z-10 ml-4 mb-4">
                                 <button 
                                    onClick={() => setShowSnippets(!showSnippets)} 
                                    className="bg-slate-800 border border-slate-700 shadow-lg p-2 rounded-lg text-indigo-400 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-xs font-medium"
                                 >
                                     <LayoutList size={14} />
                                     {showSnippets ? 'Hide Snippets' : `Show ${extractedSnippets.length} Snippets`}
                                 </button>
                             </div>
                        )}
                        
                        <ReactMarkdown 
                            components={{
                            h1: ({node, ...props}) => <h1 className="text-xl font-bold text-white border-b border-slate-800 pb-2 mb-6" {...props} />,
                            h2: ({node, ...props}) => <h2 className="text-lg font-semibold text-indigo-400 mt-8 mb-3 flex items-center gap-2" {...props} />,
                            h3: ({node, ...props}) => <h3 className="text-md font-medium text-cyan-400 mt-6 mb-2" {...props} />,
                            ul: ({node, ...props}) => <ul className="space-y-1 my-4 list-disc list-outside ml-4 text-slate-300" {...props} />,
                            li: ({node, ...props}) => <li className="pl-1" {...props} />,
                            strong: ({node, ...props}) => <strong className="text-white font-semibold" {...props} />,
                            blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-indigo-500/50 pl-4 my-4 italic text-slate-400 bg-slate-900/30 py-2 rounded-r" {...props} />,
                            code: ({node, className, ...props}) => {
                                const match = /language-(\w+)/.exec(className || '')
                                return match 
                                ? <code className={`${className} block bg-slate-900 rounded-lg p-4 border border-slate-800 text-sm overflow-x-auto my-4 text-indigo-200 shadow-inner`} {...props} />
                                : <code className="bg-slate-800/50 rounded px-1.5 py-0.5 text-sm text-indigo-300 font-mono" {...props} />
                            },
                            pre: ({node, ...props}) => <pre className="bg-transparent p-0 m-0" {...props} />
                            }}
                        >
                            {analysis}
                        </ReactMarkdown>
                    </div>
                    
                    {/* Extracted Snippets Sidebar */}
                    {showSnippets && extractedSnippets.length > 0 && (
                        <div className="w-72 flex-shrink-0 border-l border-slate-800 pl-4 hidden md:flex flex-col animate-in slide-in-from-right-4 sticky top-0 h-fit max-h-[80vh]">
                            <div className="mb-4">
                                <h4 className="text-sm font-bold text-slate-300 mb-2 flex items-center gap-2"><Scissors size={14}/> Snippets</h4>
                                <div className="relative mb-2">
                                    <Search size={12} className="absolute left-2 top-2 text-slate-500" />
                                    <input 
                                        type="text"
                                        value={snippetSearch}
                                        onChange={(e) => setSnippetSearch(e.target.value)}
                                        placeholder="Search snippets..."
                                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 pl-7 text-xs focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <select 
                                    value={snippetFilterLang}
                                    onChange={(e) => setSnippetFilterLang(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 text-slate-400"
                                >
                                    <option value="All">All Languages</option>
                                    {uniqueLangs.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                            </div>
                            <div className="overflow-y-auto space-y-3 pr-2">
                                {filteredSnippets.map((snip, i) => (
                                    <div key={snip.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3 hover:border-indigo-500/50 transition-colors group">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] uppercase font-mono text-slate-500 group-hover:text-indigo-400 transition-colors">{snip.lang}</span>
                                            <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                  onClick={() => applyAgentCode(`\`\`\`${snip.lang}\n${snip.code}\n\`\`\``, 'append')}
                                                  className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400"
                                                  title="Append to editor"
                                                >
                                                    <ArrowDown size={12}/>
                                                </button>
                                                <button 
                                                  onClick={() => navigator.clipboard.writeText(snip.code)}
                                                  className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400"
                                                  title="Copy"
                                                >
                                                    <Copy size={12}/>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-[10px] font-mono text-slate-400 line-clamp-4 overflow-hidden bg-slate-950/50 p-1.5 rounded border border-slate-900">
                                            {snip.code}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                  </div>
                )}

                {/* DIAGRAMS VIEW (MERMAID) Content Only */}
                {activeView === 'diagrams' && (
                    <div className="h-full flex flex-col min-h-[400px]">
                        <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-lg p-4 overflow-auto flex items-center justify-center min-h-[300px]">
                            {isGeneratingDiagram ? (
                                <div className="flex flex-col items-center gap-2">
                                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                    <span className="text-slate-500 text-sm">Visualizing architecture...</span>
                                </div>
                            ) : diagramError ? (
                                <div className="flex flex-col items-center gap-2 text-red-400 p-6 border border-red-900/30 bg-red-900/10 rounded-lg">
                                    <AlertCircle className="w-8 h-8" />
                                    <span className="text-sm font-medium text-center">{diagramError}</span>
                                    <button onClick={handleGenerateDiagram} className="mt-2 text-xs underline hover:text-red-300">Try Again</button>
                                </div>
                            ) : mermaidCode ? (
                                <div id="mermaid-graph" className="mermaid w-full h-full flex justify-center items-center" key={mermaidCode}>
                                    {mermaidCode}
                                </div>
                            ) : (
                                <div className="text-slate-500 text-sm text-center">
                                    Click 'Generate' above to visualize the codebase structure.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ROADMAP VIEW (KANBAN) Content Only */}
                {activeView === 'roadmap' && (
                    <div className="h-full flex flex-col min-h-[400px]">
                        {isGeneratingRoadmap ? (
                                <div className="text-center py-12 text-slate-500 flex flex-col items-center gap-2">
                                     <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                     <span>Converting analysis into actionable tasks...</span>
                                </div>
                        ) : roadmapTasks.length > 0 ? (
                            <div className="flex gap-4 overflow-x-auto h-full pb-4">
                                {(['todo', 'in-progress', 'done'] as const).map(status => (
                                    <div 
                                        key={status} 
                                        className="flex-1 min-w-[250px] bg-slate-900/50 rounded-lg border border-slate-800 flex flex-col"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => onDrop(e, status)}
                                    >
                                        <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-lg">
                                            <h4 className="text-sm font-medium uppercase text-slate-400 tracking-wide">
                                                {status === 'todo' ? 'To Do' : status === 'in-progress' ? 'In Progress' : 'Done'}
                                            </h4>
                                            <span className="text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-500">
                                                {roadmapTasks.filter(t => t.status === status).length}
                                            </span>
                                        </div>
                                        <div className="p-2 space-y-2 overflow-y-auto flex-1">
                                            {roadmapTasks.filter(t => t.status === status).map(task => (
                                                <div 
                                                    key={task.id}
                                                    draggable
                                                    onDragStart={(e) => onDragStart(e, task.id)}
                                                    className="bg-slate-950 border border-slate-800 p-3 rounded hover:border-indigo-500/50 cursor-grab active:cursor-grabbing shadow-sm group"
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className={`text-[10px] px-1.5 rounded border ${
                                                            task.priority === 'High' ? 'border-red-900 text-red-400' :
                                                            task.priority === 'Medium' ? 'border-amber-900 text-amber-400' :
                                                            'border-emerald-900 text-emerald-400'
                                                        }`}>
                                                            {task.priority}
                                                        </span>
                                                        <GripVertical size={12} className="text-slate-600 group-hover:text-slate-400"/>
                                                    </div>
                                                    <p className="text-xs text-slate-200 font-medium leading-snug mb-1">{task.title}</p>
                                                    <span className="text-[10px] text-slate-500 uppercase">{task.category}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-slate-500 text-sm text-center py-12">
                                Generate a roadmap to turn the audit report into a Kanban board.
                            </div>
                        )}
                    </div>
                )}

                {/* README VIEW */}
                {activeView === 'readme' && readmeContent && (
                <div className="relative group">
                    <div className="absolute top-0 right-0 z-10">
                    <button 
                        onClick={handleCopyReadme}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded border border-slate-700 transition-colors"
                    >
                        {hasCopiedReadme ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                        {hasCopiedReadme ? 'Copied!' : 'Copy Markdown'}
                    </button>
                    </div>
                    <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 font-mono text-sm text-slate-300 whitespace-pre-wrap leading-relaxed shadow-inner">
                    {readmeContent}
                    </div>
                </div>
                )}

                {/* COMMITS VIEW Content Only */}
                {activeView === 'commits' && (
                    <div className="max-w-3xl mx-auto">
                        <div className="relative border-l-2 border-slate-800 ml-3 space-y-8 pl-8 py-2">
                            {commits.map((c, idx) => (
                            <div key={c.sha} className="relative group">
                                <div className="absolute -left-[41px] top-1.5 w-4 h-4 rounded-full bg-slate-950 border-2 border-indigo-500 shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform"></div>
                                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 hover:bg-slate-900 hover:border-indigo-500/30 transition-all">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex flex-col gap-1">
                                             <a href={c.html_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline font-mono text-sm font-medium flex items-center gap-2">
                                                 <GitBranch size={12}/> {c.sha.substring(0, 7)}
                                             </a>
                                             <span className="text-xs text-slate-500">{new Date(c.commit.author.date).toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {c.author ? (
                                                <a href={c.author.html_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors bg-slate-950 px-2 py-1 rounded border border-slate-800">
                                                    {c.author.avatar_url && <img src={c.author.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
                                                    {c.author.login}
                                                </a>
                                            ) : (
                                                <span className="text-xs text-slate-400">{c.commit.author.name}</span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-300 leading-relaxed font-sans">{c.commit.message}</p>
                                </div>
                            </div>
                            ))}
                            {commits.length === 0 && !isLoadingCommits && (
                                <div className="text-slate-500 text-sm">No commits found. Try refreshing.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* AGENT VIEW (CHAT) */}
                {activeView === 'agent' && (
                    <div className="flex flex-col min-h-full pb-2 space-y-6">
                    {agentMessages.map((msg, index) => (
                        <div key={index} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-800 border border-slate-700' : 'bg-emerald-900/20 border border-emerald-900/50'}`}>
                                {msg.role === 'user' ? <div className="text-slate-400">U</div> : <Bot size={16} className="text-emerald-400"/>}
                            </div>
                            <div className={`max-w-[85%] rounded-2xl p-4 ${
                                msg.role === 'user' 
                                    ? 'bg-slate-800 text-slate-200 rounded-tr-none' 
                                    : 'bg-slate-900 border border-slate-800 text-slate-300 rounded-tl-none'
                            }`}>
                                {msg.images && msg.images.map((img, i) => (
                                    <img key={i} src={img} alt="Input" className="max-h-48 rounded mb-3 border border-slate-700" />
                                ))}
                                
                                <div className="markdown-content">
                                    <ReactMarkdown 
                                        components={{
                                            code: ({node, className, ...props}) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return match 
                                                ? <code className={`${className} block bg-slate-950 rounded-lg p-3 border border-emerald-900/30 text-xs overflow-x-auto my-2 text-emerald-100`} {...props} />
                                                : <code className="bg-emerald-900/20 rounded px-1 py-0.5 text-xs text-emerald-300 font-mono" {...props} />
                                            }
                                        }}
                                    >
                                        {msg.text}
                                    </ReactMarkdown>
                                </div>

                                {msg.role === 'model' && (
                                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800/50 flex-wrap">
                                        <button 
                                            onClick={() => applyAgentCode(msg.text, 'append')} 
                                            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[10px] transition-colors"
                                            title="Append code to editor"
                                        >
                                            <ArrowDown size={10} /> Append
                                        </button>
                                        <button 
                                            onClick={() => applyAgentCode(msg.text, 'replace')} 
                                            className="flex items-center gap-1 px-2 py-1 bg-emerald-900/20 hover:bg-emerald-900/30 border border-emerald-900/50 text-emerald-400 rounded text-[10px] transition-colors"
                                            title="Replace all code in editor"
                                        >
                                            {msg.text.includes('<<<<<<< SEARCH') ? <GitBranch size={10}/> : <ArrowLeftRight size={10} />}
                                            {msg.text.includes('<<<<<<< SEARCH') ? 'Review Diff' : 'Replace All'}
                                        </button>
                                        <div className="flex-1" />
                                        <button
                                            onClick={() => handlePlaySpeech(msg.text, index)}
                                            className={`p-1.5 rounded hover:bg-slate-800 transition-colors ${msg.isSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-500 hover:text-emerald-400'}`}
                                            title="Read Aloud"
                                        >
                                            <Volume2 size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isAgentThinking && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-lg bg-emerald-900/20 border border-emerald-900/50 flex items-center justify-center">
                                <Bot size={16} className="text-emerald-400"/>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-4 flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                <span className="text-xs text-slate-500">Processing...</span>
                            </div>
                        </div>
                    )}
                    </div>
                )}
                <div ref={outputEndRef} />
            </div>
          </div>
          
          {/* AGENT PROMPT INPUT */}
          {activeView === 'agent' && (
             <div className="absolute bottom-0 left-0 right-0 p-4 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm z-40">
                {agentImages.length > 0 && (
                    <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
                        {agentImages.map((img, i) => (
                            <div key={i} className="relative group">
                                <img src={img} alt="Upload preview" className="h-16 w-16 object-cover rounded border border-slate-700" />
                                <button 
                                    onClick={() => setAgentImages(prev => prev.filter((_, idx) => idx !== i))}
                                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex flex-col gap-2">
                   <div className="relative">
                      <textarea 
                         value={agentPrompt}
                         onChange={(e) => setAgentPrompt(e.target.value)}
                         placeholder={selectedCode ? "Asking about selected code..." : "Ask agent to generate code, fix bugs, or explain logic..."}
                         className={`w-full bg-slate-950 border rounded-lg pl-4 pr-24 py-3 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none resize-none h-20 placeholder:text-slate-600 transition-all ${selectedCode ? 'border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'border-slate-700'}`}
                         onKeyDown={(e) => {
                             if (e.key === 'Enter' && !e.shiftKey) {
                                 e.preventDefault();
                                 handleAgentPrompt();
                             }
                         }}
                      />
                      
                      <div className="absolute right-2 bottom-2 flex items-center gap-2">
                         {/* Fast Mode Toggle */}
                         <button
                             onClick={() => setIsFastMode(!isFastMode)}
                             className={`p-2 rounded-lg transition-all flex items-center gap-1 ${isFastMode ? 'text-amber-400 bg-amber-900/20' : 'text-slate-500 hover:text-slate-300'}`}
                             title={isFastMode ? "Fast Mode (Gemini Flash)" : "Deep Reasoning (Gemini Pro)"}
                         >
                             <Zap size={18} className={isFastMode ? "fill-current" : ""} />
                         </button>

                         <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            ref={imageInputRef} 
                            onChange={handleImageUpload}
                         />
                         <button
                            onClick={() => imageInputRef.current?.click()}
                            className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                            title="Upload Image"
                         >
                            <ImageIcon size={18} />
                         </button>
                         
                         <button
                            onClick={toggleListening}
                            className={`p-2 rounded-lg transition-colors ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800'}`}
                            title="Voice Input"
                         >
                            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                         </button>

                         <button
                            onClick={handleAgentPrompt}
                            disabled={(isAgentThinking || (!agentPrompt.trim() && agentImages.length === 0))}
                            className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                         >
                            {isAgentThinking ? <Loader2 size={18} className="animate-spin"/> : <Sparkles size={18}/>}
                         </button>
                      </div>
                   </div>
                   <div className="flex justify-between text-[10px] text-slate-500 px-1">
                      <span className="flex items-center gap-2">
                          {selectedCode ? (
                              <span className="text-indigo-400 flex items-center gap-1"><MousePointerClick size={10}/> Context: {codeContext.length} chars + Selection</span>
                          ) : (
                              <span>Context: {codeContext.length} chars</span>
                          )}
                      </span>
                      <span className="flex items-center gap-1">
                          {isFastMode ? "Gemini 2.5 Flash (Fast)" : "Gemini 3.0 Pro (Deep)"}
                      </span>
                   </div>
                </div>
             </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default RepoView;
