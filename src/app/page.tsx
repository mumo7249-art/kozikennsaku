'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';

// --- Types ---
interface Source {
  title: string;
  pid: string;
  page: string;
  snippet: string;
  link: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Source[];
}

interface Thread {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

interface SearchResult {
  threadId: string;
  threadTitle: string;
  messageId: string;
  content: string;
}

// --- Crypto Utilities ---
/**
 * セキュアな保存のための簡易暗号化 (AES-GCM)
 * ※クライアントサイドのみの保護ですが、平文での露出を避けます。
 */
const ENCRYPTION_KEY = 'ndl-chat-vault-key'; // ソルト/キー識別子として使用

async function encryptData(text: string) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const password = encoder.encode(ENCRYPTION_KEY);

    const key = await crypto.subtle.importKey(
      'raw', password, { name: 'PBKDF2' }, false, ['deriveKey']
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);

    // Salt + IV + Data の順で結合してBase64化
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.error('Encryption failed', e);
    return text;
  }
}

async function decryptData(cipherText: string) {
  try {
    const combined = new Uint8Array(atob(cipherText).split('').map(c => c.charCodeAt(0)));
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const data = combined.slice(28);

    const encoder = new TextEncoder();
    const password = encoder.encode(ENCRYPTION_KEY);

    const key = await crypto.subtle.importKey(
      'raw', password, { name: 'PBKDF2' }, false, ['deriveKey']
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      key, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Decryption failed', e);
    return '';
  }
}

// --- Components ---

/**
 * 用語ホバー時に表示されるポップアップ（出典詳細）
 */
const CitationPopup = ({ source, children }: { source: Source; children: React.ReactNode }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <span className="cursor-help border-b border-dotted border-[#a52a2a] text-[#a52a2a] bg-[#a52a2a]/5 px-0.5 rounded transition-colors hover:bg-[#a52a2a]/10">
        {children}
      </span>
      {isVisible && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-[85vw] max-w-72 p-4 bg-white border border-[#dcd3b6] shadow-2xl rounded-lg text-xs text-[#2d2a26] animate-in fade-in zoom-in-95 duration-200">
          <p className="font-bold mb-2 text-[#a52a2a] border-b border-[#dcd3b6] pb-1">【出典】『{source.title}』</p>
          <p className="italic text-[#6b6b6b] mb-3 leading-relaxed line-clamp-4">「{source.snippet}」</p>
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#f4f1e6]">
            <span className="text-[10px] text-[#9b9b9b] bg-[#f4f1e6] px-1.5 py-0.5 rounded">第{source.page}コマ</span>
            <a
              href={source.link}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-[#a52a2a] text-white rounded shadow-sm hover:bg-[#8b2323] transition-all hover:scale-105 active:scale-95 text-[10px]"
            >
              NDL ↗
            </a>
          </div>
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-[8px] border-transparent border-t-white"></span>
        </span>
      )}
    </span>
  );
};

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');
  const [apiKey, setApiKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // --- Persistence ---
  useEffect(() => {
    const init = async () => {
      const saved = localStorage.getItem('ndl-chat-threads');
      const savedEncryptedKey = localStorage.getItem('ndl-gemini-api-key-v2');

      if (savedEncryptedKey) {
        const decrypted = await decryptData(savedEncryptedKey);
        setApiKey(decrypted);
      }

      if (saved) {
        try {
          const parsed: Thread[] = JSON.parse(saved);
          // IDが欠けている古いデータへの互換性処理
          const migrated = parsed.map(t => ({
            ...t,
            messages: t.messages.map((m, idx) => ({
              ...m,
              id: m.id || `msg-${t.id}-${idx}`
            }))
          }));
          setThreads(migrated);
          if (migrated.length > 0) setActiveThreadId(migrated[0].id);
        } catch (e) {
          console.error('Failed to load threads', e);
        }
      } else {
        createNewThread();
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (threads.length > 0) {
      localStorage.setItem('ndl-chat-threads', JSON.stringify(threads));
    }
  }, [threads]);

  useEffect(() => {
    if (scrollRef.current && !highlightedMessageId) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (highlightedMessageId && messageRefs.current[highlightedMessageId]) {
      messageRefs.current[highlightedMessageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setHighlightedMessageId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedMessageId]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeThreadId) || null, [threads, activeThreadId]);

  // --- Search Logic ---
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const results: SearchResult[] = [];
    threads.forEach(t => {
      t.messages.forEach(m => {
        if (m.role !== 'system' && m.content.toLowerCase().includes(searchTerm.toLowerCase())) {
          results.push({
            threadId: t.id,
            threadTitle: t.title,
            messageId: m.id,
            content: m.content
          });
        }
      });
    });
    return results;
  }, [threads, searchTerm]);

  // --- Handlers ---
  const createNewThread = () => {
    const newThread: Thread = {
      id: Date.now().toString(),
      title: '新しい対話',
      messages: [{
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'ようこそ。国立国会図書館の古き資料から、不思議な話を探してまいります。何を知りたいですか？'
      }],
      updatedAt: Date.now(),
    };
    setThreads(prev => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    setSearchTerm('');
  };

  const handleRename = (id: string) => {
    if (!editTitle.trim()) return;
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title: editTitle } : t));
    setEditingThreadId(null);
  };

  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const executeDelete = () => {
    if (!deleteId) return;
    setThreads(prev => {
      const filtered = prev.filter(t => t.id !== deleteId);
      if (activeThreadId === deleteId) {
        setActiveThreadId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
    setDeleteId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeThreadId) return;

    const userMessage = input;
    const msgId = `msg-${Date.now()}`;
    setInput('');

    setThreads(prev => prev.map(t => t.id === activeThreadId ? {
      ...t,
      messages: [...t.messages, { id: msgId, role: 'user', content: userMessage }],
      updatedAt: Date.now()
    } : t));

    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-key': apiKey
        },
        body: JSON.stringify({ message: userMessage, model: selectedModel }),
      });

      const data = await response.json();
      const assistantId = `msg-${Date.now() + 1}`;

      if (response.status === 429) {
        setThreads(prev => prev.map(t => t.id === activeThreadId ? {
          ...t,
          messages: [...t.messages, {
            id: assistantId,
            role: 'system',
            content: '⚠️ 利用制限に達しました。左下のプルダウンから「別のモデル」に切り替えるか、右上の設定（歯車）よりご自身のAPIキーを登録してください。'
          }],
          updatedAt: Date.now()
        } : t));
        return;
      }

      setThreads(prev => prev.map(t => t.id === activeThreadId ? {
        ...t,
        title: t.messages.length <= 2 ? userMessage.slice(0, 15) : t.title,
        messages: [...t.messages, data.reply ? {
          id: assistantId,
          role: 'assistant',
          content: data.reply,
          sources: data.sources
        } : {
          id: assistantId,
          role: 'system',
          content: `申し訳ございません。${data.details || '情報の取得に失敗いたしました。'}`
        }],
        updatedAt: Date.now()
      } : t));

    } catch (error) {
      const errorId = `msg-${Date.now() + 2}`;
      setThreads(prev => prev.map(t => t.id === activeThreadId ? {
        ...t,
        messages: [...t.messages, { id: errorId, role: 'system', content: '通信に問題が発生いたしました。' }],
      } : t));
    } finally {
      setIsLoading(false);
    }
  };

  const jumpToMessage = (result: SearchResult) => {
    setActiveThreadId(result.threadId);
    setHighlightedMessageId(result.messageId);
    setSearchTerm('');
  };

  const exportThreadToMarkdown = (thread: Thread) => {
    let content = `# ${thread.title}\n\n`;
    content += `生成日: ${new Date(thread.updatedAt).toLocaleString('ja-JP')}\n`;
    content += `ソース: NDL 考古学探索システム\n\n---\n\n`;

    thread.messages.forEach(msg => {
      if (msg.role === 'system') return;

      const roleName = msg.role === 'user' ? '【問】(User)' : '【答】(Assistant)';
      content += `### ${roleName}\n\n${msg.content}\n\n`;

      if (msg.sources && msg.sources.length > 0) {
        content += `#### 参考文献:\n`;
        msg.sources.forEach((src, idx) => {
          content += `- [${idx + 1}] 『${src.title}』 (第${src.page}コマ)\n  リンク: ${src.link}\n  抜粋: 「${src.snippet}」\n`;
        });
        content += `\n`;
      }
      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thread.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderMessageContent = (content: string, sources?: Source[]) => {
    if (!sources || sources.length === 0) return content;
    const parts = content.split(/(<cite id="\d+">[\s\S]*?<\/cite>)/g);

    return parts.map((part, i) => {
      const match = part.match(/<cite id="(\d+)">([\s\S]*?)<\/cite>/);
      if (match) {
        const id = parseInt(match[1]) - 1;
        const text = match[2];
        const source = sources[id];
        if (source) return <CitationPopup key={i} source={source}>{text}</CitationPopup>;
      }
      return part;
    });
  };

  return (
    <div className="flex h-screen bg-[#f4f1e6] text-[#2d2a26] overflow-hidden font-japanese">
      {/* --- Sidebar Overlay for Mobile --- */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-30 sm:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* --- Sidebar --- */}
      <aside className={`fixed inset-y-0 left-0 bg-[#e5e1d3] border-r border-[#dcd3b6] transition-all duration-300 flex flex-col z-40 sm:relative ${isSidebarOpen ? 'w-full sm:w-72 translate-x-0' : 'w-0 -translate-x-full sm:translate-x-0 overflow-hidden'}`}>
        <div className="p-4 border-b border-[#dcd3b6] bg-[#dcd3b6]/20">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold tracking-widest text-[#a52a2a] text-sm">対話の巻物</h2>
            <button onClick={createNewThread} className="w-8 h-8 rounded-full hover:bg-[#dcd3b6] flex justify-center items-center transition-colors shadow-sm bg-white" title="新規対話">
              <span className="text-[#a52a2a] text-xl font-light">＋</span>
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="過去の発言を辿る..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full p-2 pl-8 rounded border border-[#dcd3b6] bg-white text-xs focus:ring-1 focus:ring-[#a52a2a] outline-none"
            />
            <span className="absolute left-2 top-1.5 opacity-30 text-xs">🔍</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {searchTerm.trim() ? (
            <div className="space-y-2">
              <p className="text-[10px] text-[#6b6b6b] px-2 mb-2">検索結果: {searchResults.length}件</p>
              {searchResults.map((res, idx) => (
                <div
                  key={`${res.messageId}-${idx}`}
                  onClick={() => jumpToMessage(res)}
                  className="bg-white/50 p-2 rounded cursor-pointer hover:bg-[#dcd3b6]/50 transition-colors border border-transparent hover:border-[#dcd3b6]"
                >
                  <p className="text-[9px] text-[#a52a2a] font-bold truncate mb-1">{res.threadTitle}</p>
                  <p className="text-[10px] text-[#2d2a26] line-clamp-2 italic">「{res.content}」</p>
                </div>
              ))}
            </div>
          ) : (
            threads.sort((a, b) => b.updatedAt - a.updatedAt).map(t => (
              <div
                key={t.id}
                onClick={() => setActiveThreadId(t.id)}
                className={`p-3 rounded cursor-pointer group relative flex flex-col transition-all ${t.id === activeThreadId ? 'bg-[#dcd3b6] shadow-sm ring-1 ring-[#c8c1a6]' : 'hover:bg-[#dcd3b6]/40'}`}
              >
                {editingThreadId === t.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleRename(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename(t.id)}
                    className="text-xs bg-white border border-[#a52a2a] p-1 rounded outline-none w-full"
                  />
                ) : (
                  <div className="flex justify-between items-center overflow-hidden">
                    <span className="text-xs truncate font-medium flex-1 pr-4">{t.title}</span>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity space-x-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingThreadId(t.id); setEditTitle(t.title); }}
                        className="p-1 hover:text-[#a52a2a] text-[10px]"
                        title="名前を変更"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); exportThreadToMarkdown(t); }}
                        className="p-1 hover:text-[#a52a2a] text-[10px]"
                        title="Markdownで保存"
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => confirmDelete(t.id, e)}
                        className="p-1 hover:text-[#a52a2a] text-[10px]"
                        title="削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                <span className="text-[8px] text-[#9b9b9b] mt-1">{new Date(t.updatedAt).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* --- Delete Confirmation Overlay --- */}
      {deleteId && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#fdfaf4] p-6 rounded-lg border-2 border-[#a52a2a] shadow-2xl max-w-xs w-full text-center">
            <h3 className="font-bold text-[#a52a2a] mb-2 tracking-widest">対話の消去</h3>
            <p className="text-xs text-[#6b6b6b] mb-6">これまでの対話を書庫から抹消いたしますか？この操作は取り消せません。</p>
            <div className="flex gap-4">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2 text-xs border border-[#dcd3b6] rounded hover:bg-[#dcd3b6]/30 transition-colors"
              >
                止める
              </button>
              <button
                onClick={executeDelete}
                className="flex-1 py-2 text-xs bg-[#a52a2a] text-white rounded hover:bg-[#8b2323] transition-colors font-bold shadow-md"
              >
                抹消する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Settings Modal --- */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-[#fdfaf4] p-8 rounded-2xl border-2 border-[#dcd3b6] shadow-2xl max-w-md w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#a52a2a] to-transparent opacity-30"></div>

            <h3 className="font-japanese font-bold text-[#a52a2a] mb-6 tracking-[0.2em] text-center text-lg">御仕度（設定）</h3>

            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-[#6b6b6b] mb-2 tracking-widest uppercase">Gemini API Key</label>
                <input
                  type="password"
                  placeholder="AI-..."
                  value={apiKey}
                  onChange={async (e) => {
                    const newVal = e.target.value;
                    setApiKey(newVal);
                    const encrypted = await encryptData(newVal);
                    localStorage.setItem('ndl-gemini-api-key-v2', encrypted);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-[#dcd3b6] bg-white text-sm focus:ring-2 focus:ring-[#a52a2a] focus:border-transparent outline-none transition-all shadow-inner"
                />
                <p className="mt-3 text-[10px] text-[#9b9b9b] leading-relaxed">
                  ※Google AI Studioで取得したキーを入力してください。お使いのブラウザ（localStorage）にのみ暗号化されず保存されます。
                </p>
              </div>

              <div className="pt-4 border-t border-[#dcd3b6]/50">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-3 bg-[#a52a2a] text-white font-bold rounded-xl shadow-lg hover:bg-[#8b2323] hover:shadow-2xl active:scale-[0.98] transition-all tracking-widest"
                >
                  設定を閉じる
                </button>
              </div>
            </div>

            <button
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-[#9b9b9b] hover:text-[#a52a2a] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* --- Main Chat Area --- */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-[#fefdfa]">
        <header className="px-4 py-3 border-b border-[#dcd3b6] bg-white/60 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-3 sm:gap-4 overflow-hidden">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-[#dcd3b6] rounded-full transition-all text-[#a52a2a] flex-shrink-0"
              title="サイドバー切替"
            >
              {isSidebarOpen ? '❮' : '❯'}
            </button>
            <div className="border-l border-[#dcd3b6] pl-3 sm:pl-4 h-6 flex-shrink-0"></div>
            <h1 className="text-sm sm:text-lg font-bold tracking-tight sm:tracking-[0.2em] text-[#2d2a26] truncate">
              {activeThread?.title || '歴史資料横断検索'}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-[#dcd3b6] rounded-full transition-all text-[#6b6b6b] hover:text-[#a52a2a]"
              title="設定"
            >
              ⚙️
            </button>
            <div className="text-[8px] sm:text-[9px] text-[#9b9b9b] tracking-wider text-right uppercase flex-shrink-0">
              <span className="hidden xs:inline">NDL Digital Collection </span>Assistant
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:py-8 md:px-12 space-y-6 sm:space-y-8 scroll-smooth" ref={scrollRef}>
          {activeThread?.messages.map((msg, i) => (
            <div
              key={msg.id || `msg-${i}`}
              ref={el => { messageRefs.current[msg.id] = el; }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-500`}
            >
              <div className={`max-w-[90%] md:max-w-[85%] p-6 rounded-2xl shadow-sm border leading-relaxed relative ${msg.role === 'user'
                ? 'bg-[#a52a2a] text-[#fdfaf4] border-[#8b2323] rounded-tr-none'
                : msg.role === 'system'
                  ? 'bg-red-50 text-red-700 border-red-200 text-sm italic'
                  : `bg-white text-[#2d2a26] border-[#dcd3b6] rounded-tl-none transition-all duration-1000 ${highlightedMessageId === msg.id ? 'ring-2 ring-yellow-400 ring-offset-4 bg-yellow-50' : ''}`
                }`}>
                {msg.role === 'assistant' && <div className="absolute -top-3 -left-1 text-[10px] bg-[#dcd3b6] px-2 py-0.5 rounded text-[#6b6b6b] font-bold">資料記録部</div>}

                <div className="text-sm md:text-base whitespace-pre-wrap">
                  {renderMessageContent(msg.content, msg.sources)}
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-8 pt-5 border-t border-[#dcd3b6]/50">
                    <p className="text-[10px] font-bold mb-4 text-[#a52a2a] tracking-[0.1em] border-l-2 border-[#a52a2a] pl-2">関連資料目録</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {msg.sources.map((src, j) => (
                        <div key={j} className="text-[10px] bg-[#fdfaf4] p-4 rounded-xl border border-[#dcd3b6] hover:border-[#a52a2a]/30 transition-all hover:shadow-lg group">
                          <p className="font-bold mb-2 text-[#2d2a26] group-hover:text-[#a52a2a] transition-colors line-clamp-1">[{j + 1}] {src.title}</p>
                          <p className="italic text-[#6b6b6b] line-clamp-3 mb-3 leading-relaxed">「{src.snippet}」</p>
                          <div className="flex justify-between items-center">
                            <span className="text-[#9b9b9b]">第{src.page}コマ</span>
                            <a href={src.link} target="_blank" rel="noopener noreferrer" className="text-[#a52a2a] hover:underline font-bold flex items-center gap-1">
                              写本を見る <span className="text-xs">↗</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white/90 p-6 rounded-2xl border border-[#dcd3b6] flex items-center gap-3">
                <div className="w-2 h-2 bg-[#a52a2a] rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-[#a52a2a] rounded-full animate-bounce delay-150"></div>
                <div className="w-2 h-2 bg-[#a52a2a] rounded-full animate-bounce delay-300"></div>
                <span className="text-xs text-[#a52a2a] font-bold tracking-widest ml-2">書物より記憶を呼び覚ましております...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-gradient-to-t from-[#f4f1e6] to-[#f4f1e6]/0 pointer-events-none absolute bottom-0 left-0 right-0 h-40"></div>

        <footer className="p-4 sm:p-6 md:p-10 relative z-10 bg-[#f4f1e6]/80 backdrop-blur-sm border-t border-[#dcd3b6]">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex flex-col gap-3">
            <div className="flex gap-2 sm:gap-4">
              <div className="relative group">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="h-full pl-3 pr-8 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-[#dcd3b6] bg-white text-xs font-bold text-[#a52a2a] outline-none hover:border-[#a52a2a] transition-all appearance-none cursor-pointer shadow-sm min-w-[120px] sm:min-w-[150px]"
                  disabled={isLoading}
                >
                  <optgroup label="Gemini (Google)">
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-flash-latest">Gemini 1.5 Flash</option>
                    <option value="gemini-pro-latest">Gemini 1.5 Pro</option>
                    <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
                  </optgroup>
                  <optgroup label="Claude (Anthropic) - Coming Soon">
                    <option value="claude-3-5-sonnet" disabled>Claude 3.5 Sonnet</option>
                  </optgroup>
                  <optgroup label="OpenAI - Coming Soon">
                    <option value="gpt-4o" disabled>GPT-4o</option>
                  </optgroup>
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#a52a2a] opacity-50 text-[10px]">▼</span>
              </div>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="歴史を問う..."
                className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-[#dcd3b6] bg-white shadow-inner text-sm focus:outline-none focus:ring-2 focus:ring-[#a52a2a] focus:border-transparent transition-all placeholder:text-[#9b9b9b]"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-4 sm:px-8 bg-[#a52a2a] text-white font-bold rounded-xl sm:rounded-2xl shadow-xl hover:bg-[#8b2323] hover:shadow-2xl active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
              >
                <span>問う</span>
                <span className="text-lg opacity-80 hidden sm:inline">≫</span>
              </button>
            </div>
          </form>
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center mt-4 sm:mt-6 gap-2">
            <p className="text-[9px] sm:text-[10px] text-[#9b9b9b] tracking-tight text-center sm:text-left">
              ※本システムは国立国会図書館のオープンデータを利用しています。
            </p>
            <p className="text-[8px] sm:text-[9px] font-bold text-[#a52a2a] tracking-widest uppercase opacity-60">
              Antigravity Research Labs
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
