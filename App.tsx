import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Page } from 'react-pdf'; 
import ReactMarkdown from 'react-markdown';
import { PaperFile, PaperSummary, SidebarTab, ChatMessage, AppMode, PageTranslation, ContentBlock, CitationInfo, AppearanceSettings, Note } from './types';
import { generatePaperSummary, chatWithPaper, translatePageContent, analyzeCitation, explainEquation } from './services/geminiService';
import { chatWithDeepSeek } from './services/deepseekService';
import SummaryView from './components/SummaryView';
import ChatInterface from './components/ChatInterface';
import Translator from './components/Translator';
import PDFViewer from './components/PDFViewer';
import TranslationViewer from './components/TranslationViewer';
import { UploadIcon, BookOpenIcon, XIcon, SettingsIcon, GripVerticalIcon, StarIcon } from './components/IconComponents';

// 引入新创建的 UI 组件
import { MagicCard, ScholarCatMascot, RpgButton } from './components/UI';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.UPLOAD);
  const [file, setFile] = useState<PaperFile | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab | 'DUAL'>('DUAL');
  const [aiModel, setAiModel] = useState<'gemini' | 'deepseek'>('gemini');
  
  // PDF State
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedPage, setDebouncedPage] = useState(1);
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [triggerCapture, setTriggerCapture] = useState(0);

  // Layout State (Resizable)
  const [leftWidth, setLeftWidth] = useState(50);
  const isResizing = useRef(false);

  // Refs
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>({
    theme: 'sepia', 
    fontSize: 16,
    fontFamily: 'serif'
  });

  // Data & AI States
  const [notes, setNotes] = useState<Note[]>([]);
  const [prefetchPage, setPrefetchPage] = useState<number | null>(null);
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [pageTranslations, setPageTranslations] = useState<Map<number, PageTranslation>>(new Map());
  const [isTranslatingPage, setIsTranslatingPage] = useState(false);

  // Interactive Overlays
  const [citationInfo, setCitationInfo] = useState<CitationInfo | null>(null);
  const [equationExplanation, setEquationExplanation] = useState<string | null>(null);
  const [isAnalyzingCitation, setIsAnalyzingCitation] = useState(false);
  const [isAnalyzingEquation, setIsAnalyzingEquation] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- 😺 计算猫咪状态逻辑 ---
  const getCatState = () => {
    if (isSummarizing) return { mood: 'THINKING', msg: '正在啃读全文...' };
    if (isTranslatingPage) return { mood: 'THINKING', msg: '正在破译本页符文...' };
    if (isChatting) return { mood: 'READING', msg: '让本喵翻翻书...' };
    if (isAnalyzingCitation || isAnalyzingEquation) return { mood: 'THINKING', msg: '正在检索上古卷轴...' };
    if (notes.length > 0 && Math.random() > 0.9) return { mood: 'IDLE', msg: '你记的笔记很有深度喵！' };
    return { mood: 'IDLE', msg: toastMessage }; // 优先显示 Toast
  };
  const catState = getCatState();

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    if (mode !== AppMode.READING) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch(e.key) {
        case 'ArrowLeft': if (currentPage > 1) { setCurrentPage(p => p - 1); showToast("翻页 (Prev)"); } break;
        case 'ArrowRight': setCurrentPage(p => p + 1); showToast("翻页 (Next)"); break;
        case ' ': 
          e.preventDefault();
          if (pdfContainerRef.current) {
            pdfContainerRef.current.scrollBy({ top: pdfContainerRef.current.clientHeight * 0.8, behavior: 'smooth' });
            showToast("自动滚动 (Auto Scroll)");
          }
          break;
        case 'd': case 'D':
          setAppearance(prev => ({ ...prev, theme: prev.theme === 'sepia' ? 'dark' : 'sepia' }));
          showToast("日夜切换 (Theme Toggle)");
          break;
        case 't': case 'T':
          setLeftWidth(prev => prev > 80 ? 50 : 100);
          showToast("侧栏切换 (Toggle Sidebar)");
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, currentPage, appearance]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  // --- Resizer Logic ---
  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing.current) {
      const newWidth = (e.clientX / window.innerWidth) * 100;
      if (newWidth > 20 && newWidth < 80) setLeftWidth(newWidth);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  // --- File Logic ---
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const selectedFile = event.target.files[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Raw = e.target?.result as string;
        const base64Data = base64Raw.split(',')[1];
        const newFile: PaperFile = {
          name: selectedFile.name,
          url: URL.createObjectURL(selectedFile),
          base64: base64Data,
          mimeType: selectedFile.type
        };
        setFile(newFile);
        setMode(AppMode.READING);
        setCurrentPage(1);
        setDebouncedPage(1);
        fetchSummary(newFile);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const fetchSummary = async (currentFile: PaperFile) => {
    setIsSummarizing(true);
    try {
      const result = await generatePaperSummary(currentFile.base64, currentFile.mimeType);
      setSummary(result);
    } catch (err) { console.error(err); } finally { setIsSummarizing(false); }
  };

  // --- Page & Prefetch Logic ---
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedPage(currentPage), 600);
    return () => clearTimeout(handler);
  }, [currentPage]);

  useEffect(() => {
    if (mode === AppMode.READING) {
      if (!pageTranslations.has(debouncedPage) && !isTranslatingPage) {
        setTriggerCapture(prev => prev + 1);
      } else if (pageTranslations.has(debouncedPage) && !isTranslatingPage) {
        const nextPage = debouncedPage + 1;
        if (!pageTranslations.has(nextPage)) setPrefetchPage(nextPage);
      }
    }
  }, [debouncedPage, mode, pageTranslations, isTranslatingPage]);

  const processCanvas = async (canvas: HTMLCanvasElement, pageNum: number) => {
    if (pageTranslations.has(pageNum)) return;
    if (pageNum === debouncedPage) setIsTranslatingPage(true);
    try {
      const MAX_DIMENSION = 1000;
      let width = canvas.width, height = canvas.height, imageBase64 = '';
      // ... (Image Scaling logic remains same) ...
      // Assuming simple scaling for brevity in this display
       imageBase64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

      const translation = await translatePageContent(imageBase64);
      translation.pageNumber = pageNum;
      setPageTranslations(prev => new Map(prev).set(pageNum, translation));
      if (pageNum === prefetchPage) setPrefetchPage(null);
    } catch(e) {
      if (pageNum === debouncedPage) {
         setPageTranslations(prev => new Map(prev).set(pageNum, { 
           pageNumber: pageNum, 
           blocks: [{ type: 'paragraph', en: '', cn: '魔法能量紊乱...' }], 
           glossary: [] 
         }));
      }
    } finally { if (pageNum === debouncedPage) setIsTranslatingPage(false); }
  };

  const handleMainPageRendered = useCallback((canvas: HTMLCanvasElement, pageNum: number) => {
     if (pageNum === debouncedPage) processCanvas(canvas, pageNum);
  }, [debouncedPage]);

  const handlePrefetchRendered = useCallback(() => {
    const hiddenContainer = document.getElementById('hidden-prefetch-container');
    if (hiddenContainer && prefetchPage) {
      const canvas = hiddenContainer.querySelector('canvas');
      if (canvas) processCanvas(canvas, prefetchPage);
    }
  }, [prefetchPage]);

  // --- Interactions ---
  const handleCitationClick = async (id: string) => {
    if (!file) return;
    setIsAnalyzingCitation(true);
    setCitationInfo(null);
    try {
      const info = await analyzeCitation(id, file.base64, file.mimeType);
      setCitationInfo(info);
    } catch (e) { console.error(e); } finally { setIsAnalyzingCitation(false); }
  };

  const handleEquationClick = async (eq: string) => {
    setIsAnalyzingEquation(true);
    setEquationExplanation(null);
    try {
      const expl = await explainEquation(eq);
      setEquationExplanation(expl);
    } catch(e) { console.error(e); } finally { setIsAnalyzingEquation(false); }
  };

  const handleContextSelection = (text: string, action: 'explain' | 'save') => {
    if (action === 'explain') {
      setActiveTab(SidebarTab.CHAT);
      handleSendMessage(`请通俗解释这段话：\n"${text}"`);
    } else if (action === 'save') {
      setNotes(prev => [{ id: Date.now().toString(), text, date: new Date().toLocaleString() }, ...prev]);
      setActiveTab(SidebarTab.NOTES);
      showToast("已收藏至魔法笔记！");
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!file) return;
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setIsChatting(true);
    try {
      let answer = '';
      if (aiModel === 'deepseek') {
        const response = await chatWithDeepSeek(text);
        answer = response || "DeepSeek 暂无响应";
      } else {
        const historyForApi = chatMessages.map(m => ({ role: m.role, text: m.text }));
        answer = await chatWithPaper(historyForApi, text, file.base64, file.mimeType);
      }
      setChatMessages(prev => [...prev, { role: 'model', text: answer }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'model', text: "喵？网络似乎不通畅... 请重试", isError: true }]);
    } finally { setIsChatting(false); }
  };

  const resetApp = () => {
    setFile(null); setMode(AppMode.UPLOAD); setSummary(null); setChatMessages([]);
    setPageTranslations(new Map()); setTriggerCapture(0); setCurrentPage(1); setDebouncedPage(1);
  };

  // ================= RENDER =================

  // 1. UPLOAD MODE
  if (mode === AppMode.UPLOAD) {
    return (
      <div className="min-h-screen bg-rpg-dark flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Magic Particles */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{backgroundImage: 'radial-gradient(#DAA520 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
        
        <div className="max-w-xl w-full text-center space-y-8 animate-in fade-in duration-700 relative z-10">
          <div>
            <div className="bg-rpg-brown w-24 h-24 mx-auto flex items-center justify-center mb-6 border-4 border-rpg-dark shadow-[0_0_0_4px_#8B4513]">
              <BookOpenIcon className="text-rpg-gold w-12 h-12" />
            </div>
            <h1 className="text-4xl font-bold text-rpg-paper mb-3 pixel-font leading-relaxed tracking-wider text-shadow-lg">Scholar Scroll</h1>
            <p className="text-lg text-rpg-gold serif italic">研读卷轴 · 解锁古老知识的秘密</p>
          </div>

          <MagicCard className="hover:scale-105 transition-transform cursor-pointer group relative">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="space-y-4 py-8">
              <div className="w-16 h-16 bg-rpg-dark rounded-full flex items-center justify-center mx-auto group-hover:rotate-12 transition-transform duration-300 border-2 border-rpg-gold shadow-lg">
                <UploadIcon className="w-8 h-8 text-rpg-gold" />
              </div>
              <p className="font-bold text-lg text-rpg-dark pixel-font">召唤 PDF 卷轴</p>
              <p className="text-xs text-rpg-faded serif">(Supports .pdf format)</p>
            </div>
          </MagicCard>
        </div>
      </div>
    );
  }

  // 2. READING MODE
  return (
    <div className={`flex flex-col h-screen overflow-hidden font-sans ${appearance.theme === 'sepia' ? 'bg-rpg-paper' : 'bg-rpg-dark'}`}>
      
      {/* Hidden Prefetcher */}
      {prefetchPage && file && (
        <div id="hidden-prefetch-container" className="absolute top-0 left-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
             <PDFViewer fileUrl={file.url} pageNumber={prefetchPage} onPageChange={() => {}} onPageRendered={() => handlePrefetchRendered()} triggerCapture={1} />
        </div>
      )}

      {/* --- Header --- */}
      <div className={`h-16 border-b-4 flex items-center px-4 justify-between shrink-0 shadow-lg z-50 ${appearance.theme === 'sepia' ? 'bg-rpg-paper border-rpg-brown' : 'bg-rpg-dark border-rpg-brown'}`}>
         <div className="flex items-center gap-3">
           <div className="bg-rpg-gold p-1 border-2 border-rpg-paper">
             <BookOpenIcon className="w-6 h-6 text-rpg-dark" />
           </div>
           <span className={`font-bold pixel-font text-xs tracking-widest hidden md:block ${appearance.theme === 'sepia' ? 'text-rpg-dark' : 'text-rpg-paper'}`}>SCHOLAR SCROLL</span>
           <span className="h-6 w-1 bg-rpg-brown mx-2"></span>
           <span className="text-xs font-bold text-rpg-gold truncate max-w-[200px] pixel-font">{file?.name}</span>
         </div>

         <div className="flex gap-2 items-center">
           {/* Settings Dropdown */}
           <div className="relative">
             <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded border-2 transition-all ${showSettings ? 'bg-rpg-gold text-rpg-dark border-rpg-paper' : 'bg-transparent text-rpg-gold border-rpg-gold hover:bg-rpg-gold/20'}`}
             >
               <SettingsIcon className="w-5 h-5" />
             </button>
             
             {showSettings && (
                <div className="absolute top-full right-0 mt-2 w-72 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <MagicCard title="系统设置 (SYSTEM)">
                    {/* Model Switcher */}
                    <div className="mb-4 pb-4 border-b border-rpg-brown/30">
                      <label className="text-xs font-bold text-rpg-dark block mb-2 pixel-font">AI 模型 (MODEL)</label>
                      <div className="flex gap-2">
                        <RpgButton active={aiModel === 'gemini'} onClick={() => setAiModel('gemini')} className="flex-1">Gemini</RpgButton>
                        <RpgButton active={aiModel === 'deepseek'} onClick={() => setAiModel('deepseek')} className="flex-1">DeepSeek</RpgButton>
                      </div>
                    </div>
              
                    {/* Theme */}
                    <div className="mb-4">
                      <label className="text-xs font-bold text-rpg-dark block mb-2 pixel-font">阅读环境 (THEME)</label>
                      <div className="flex gap-2">
                         <RpgButton active={appearance.theme === 'sepia'} onClick={() => setAppearance(p => ({...p, theme: 'sepia'}))} className="flex-1">📜 羊皮纸</RpgButton>
                         <RpgButton active={appearance.theme === 'dark'} onClick={() => setAppearance(p => ({...p, theme: 'dark'}))} className="flex-1">🌙 暗夜</RpgButton>
                      </div>
                    </div>

                    {/* Font Size */}
                    <div className="mb-4">
                      <label className="text-xs font-bold text-rpg-dark block mb-2 pixel-font">字号 (SIZE): {appearance.fontSize}px</label>
                      <input 
                        type="range" min="12" max="24" step="1" 
                        value={appearance.fontSize}
                        onChange={(e) => setAppearance(p => ({...p, fontSize: parseInt(e.target.value)}))}
                        className="w-full accent-rpg-brown cursor-pointer" 
                      />
                    </div>
                  </MagicCard>
               </div>
             )}
           </div>

           {/* Tabs */}
           <div className="flex gap-1 bg-rpg-dark/10 p-1 rounded">
             {['DUAL', SidebarTab.SUMMARY, SidebarTab.CHAT, SidebarTab.NOTES].map((tab) => (
               <RpgButton 
                 key={tab} 
                 active={activeTab === tab} 
                 onClick={() => setActiveTab(tab as any)}
               >
                 {tab === 'DUAL' ? '阅' : tab === SidebarTab.SUMMARY ? '概' : tab === SidebarTab.CHAT ? '聊' : '记'}
               </RpgButton>
             ))}
           </div>
         </div>

         <button onClick={resetApp} className="ml-2 text-rpg-gold hover:text-red-400 transition-colors p-2">
           <XIcon className="w-6 h-6" />
         </button>
      </div>

      {/* --- Main Content --- */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* LEFT: PDF */}
        <div className="h-full relative bg-rpg-faded" style={{ width: `${leftWidth}%` }}>
          {file && (
             <PDFViewer 
               ref={pdfContainerRef}
               fileUrl={file.url}
               pageNumber={currentPage}
               onPageChange={setCurrentPage}
               onPageRendered={handleMainPageRendered}
               highlightText={highlightText}
               triggerCapture={triggerCapture}
               onTextSelected={handleContextSelection}
             />
          )}
        </div>

        {/* Resizer */}
        <div 
           className="w-2 bg-rpg-dark border-l border-r border-rpg-brown cursor-col-resize hover:bg-rpg-gold transition-colors flex items-center justify-center z-40"
           onMouseDown={startResizing}
        >
          <GripVerticalIcon className="w-4 h-4 text-rpg-gold" />
        </div>

        {/* RIGHT: Panels */}
        <div 
           className="h-full relative transition-colors duration-300"
           style={{ width: `${100 - leftWidth}%`, backgroundColor: appearance.theme === 'sepia' ? '#F4ECD8' : '#2c1810' }}
        >
          {activeTab === 'DUAL' && (
             <TranslationViewer 
               translation={pageTranslations.get(debouncedPage)}
               isLoading={isTranslatingPage}
               onHoverBlock={setHighlightText}
               onRetry={() => setTriggerCapture(prev => prev + 1)}
               onCitationClick={handleCitationClick}
               onEquationClick={handleEquationClick}
               appearance={appearance}
             />
          )}

          {activeTab === SidebarTab.SUMMARY && (
             <div className="p-6 h-full overflow-y-auto bg-rpg-paper">
               <SummaryView summary={summary} isLoading={isSummarizing} error={null} />
             </div>
          )}
          
          {activeTab === SidebarTab.CHAT && (
             <ChatInterface messages={chatMessages} onSendMessage={handleSendMessage} isSending={isChatting} />
          )}

          {activeTab === SidebarTab.NOTES && (
            <div className="p-6 h-full overflow-y-auto bg-rpg-paper space-y-4">
              <h3 className="font-bold pixel-font text-rpg-dark border-b-2 border-rpg-brown pb-2">魔法笔记 (Grimoire)</h3>
              {notes.length === 0 ? (
                <div className="text-center text-rpg-faded mt-10 text-sm italic">暂无笔记，请在左侧 PDF 划词收藏。</div>
              ) : (
                notes.map(note => (
                  <MagicCard key={note.id}>
                    <p className="text-rpg-dark serif text-sm mb-2 leading-relaxed">{note.text}</p>
                    <p className="text-[10px] text-rpg-brown text-right border-t border-rpg-brown/20 pt-2">{note.date}</p>
                  </MagicCard>
                ))
              )}
            </div>
          )}
        </div>

        {/* --- Modals --- */}
        
        {/* Citation Oracle */}
        {(isAnalyzingCitation || citationInfo) && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in backdrop-blur-sm">
            <MagicCard title="真视之眼 (THE ORACLE)" className="w-full max-w-lg" onClose={() => { setCitationInfo(null); setIsAnalyzingCitation(false); }}>
               {isAnalyzingCitation ? (
                 <div className="text-center py-10 space-y-4">
                   <div className="text-4xl animate-bounce">🔮</div>
                   <p className="pixel-font text-xs text-rpg-dark">正在检索上古卷轴...</p>
                 </div>
               ) : (
                 <div className="space-y-4">
                   <div className="flex justify-between items-start gap-4">
                      <h4 className="font-bold text-lg text-rpg-dark serif leading-tight">{citationInfo?.title}</h4>
                      <span className={`shrink-0 px-2 py-1 text-[10px] border-2 font-bold pixel-font ${citationInfo?.status === 'MUST_READ' ? 'bg-rpg-brown text-rpg-gold border-rpg-gold' : 'bg-rpg-paper text-rpg-dark border-rpg-dark'}`}>
                        {citationInfo?.status === 'MUST_READ' ? '必读圣经' : '普通文献'}
                      </span>
                   </div>
                   <p className="text-sm text-rpg-faded italic serif">{citationInfo?.year}</p>
                   <div className="bg-rpg-paper p-3 border-2 border-rpg-brown/30 text-sm text-rpg-dark serif leading-relaxed shadow-inner">
                     {citationInfo?.abstract}
                   </div>
                 </div>
               )}
            </MagicCard>
          </div>
        )}

        {/* Equation Lens */}
        {(isAnalyzingEquation || equationExplanation) && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 p-4">
            <MagicCard title="魔镜解析 (MAGIC LENS)" onClose={() => { setEquationExplanation(null); setIsAnalyzingEquation(false); }}>
               <div className="min-h-[100px] max-h-[300px] overflow-y-auto custom-scrollbar">
                 {isAnalyzingEquation ? (
                    <div className="text-rpg-faded pixel-font text-xs animate-pulse text-center py-4">正在解构符文结构...</div>
                 ) : (
                    <div className="prose prose-sm max-w-none text-rpg-dark serif">
                       <ReactMarkdown>{equationExplanation || ''}</ReactMarkdown>
                    </div>
                 )}
               </div>
            </MagicCard>
          </div>
        )}
      </div>
      
      {/* 😺 全局伴读猫咪 (Floating UI) */}
      <ScholarCatMascot 
        mood={catState.mood} 
        message={catState.msg} 
        onClick={() => setActiveTab(SidebarTab.CHAT)}
      />

    </div>
  );
};

export default App;
