import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Page } from 'react-pdf'; 
import ReactMarkdown from 'react-markdown';
import { PaperFile, PaperSummary, SidebarTab, ChatMessage, AppMode, PageTranslation, ContentBlock, CitationInfo, AppearanceSettings, Note } from './types';
import { extractTextFromPdf } from './utils/pdfUtils';
import { generatePaperSummary, chatWithPaper, translatePageContent, analyzeCitation, explainEquation } from './services/geminiService';
import { chatWithDeepSeek } from './services/deepseekService';
import SummaryView from './components/SummaryView';
import ChatInterface from './components/ChatInterface';
import Translator from './components/Translator';
import PDFViewer from './components/PDFViewer';
import TranslationViewer from './components/TranslationViewer';
import { UploadIcon, BookOpenIcon, XIcon, SettingsIcon, GripVerticalIcon, StarIcon } from './components/IconComponents';

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
  const [leftWidth, setLeftWidth] = useState(50); // Percentage
  const isResizing = useRef(false);

  // Refs for scrolling (manual only now)
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Settings & Appearance
  const [showSettings, setShowSettings] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSettings>({
    theme: 'sepia', // Default to Parchment mode for immersion
    fontSize: 16,
    fontFamily: 'serif'
  });

  // Notes
  const [notes, setNotes] = useState<Note[]>([]);

  // Background Pre-fetch State
  const [prefetchPage, setPrefetchPage] = useState<number | null>(null);

  // Data States
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  // Page Translation Cache
  const [pageTranslations, setPageTranslations] = useState<Map<number, PageTranslation>>(new Map());
  const [isTranslatingPage, setIsTranslatingPage] = useState(false);

  // Interactive Overlays
  const [citationInfo, setCitationInfo] = useState<CitationInfo | null>(null);
  const [equationExplanation, setEquationExplanation] = useState<string | null>(null);
  const [isAnalyzingCitation, setIsAnalyzingCitation] = useState(false);
  const [isAnalyzingEquation, setIsAnalyzingEquation] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  
  // Shortcuts Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- Keyboard Shortcuts (Power User Mode) ---
  useEffect(() => {
    if (mode !== AppMode.READING) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch(e.key) {
        case 'ArrowLeft':
          if (currentPage > 1) {
             setCurrentPage(p => p - 1);
             showToast("翻页啦！(Prev Page)");
          }
          break;
        case 'ArrowRight':
             setCurrentPage(p => p + 1);
             showToast("翻页啦！(Next Page)");
          break;
        case ' ': // Space
          e.preventDefault();
          if (pdfContainerRef.current) {
            pdfContainerRef.current.scrollBy({ top: pdfContainerRef.current.clientHeight * 0.8, behavior: 'smooth' });
            showToast("自动滚动 (Auto Scroll)");
          }
          break;
        case 'd':
        case 'D':
          setAppearance(prev => ({
            ...prev,
            theme: prev.theme === 'sepia' ? 'dark' : 'sepia'
          }));
          showToast(appearance.theme === 'sepia' ? "护眼模式已关闭" : "护眼模式已开启");
          break;
        case 't':
        case 'T':
          setLeftWidth(prev => prev > 80 ? 50 : 100); // Toggle Sidebar
          showToast("侧边栏切换 (Toggle Sidebar)");
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
      if (newWidth > 20 && newWidth < 80) {
        setLeftWidth(newWidth);
      }
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


  const handleFileUpload = async (file: File) => {
  // A. 界面初始化：先让 PDF 显示出来，不用等 AI
  const base64 = await fileToBase64(file);
  setPdfData(base64);
  
  // 生成文件指纹 (ID)
  const fingerprint = getFileFingerprint(file);

  try {
    setIsLoading(true);

    // B. 本地解析 (CPU 运算，免费)
    // ⚠️ 必须做：无论是否命中缓存，我们都需要这份文本给“聊天模式”当上下文
    console.log("正在提取 PDF 全文文本...");
    const textContent = await extractTextFromPdf(base64);
    
    // 把全文存入状态，给 Chat 功能用 (这一步很重要！)
    // 假设你有一个 setFullText 的 state，如果没有，请创建一个
    setFullText(textContent); 

    // C. 💰 省钱时刻：检查缓存
    const cachedSummary = getCachedSummary(fingerprint);

    if (cachedSummary) {
      console.log(`[Cache] 🎯 命中缓存！指纹: ${fingerprint}`);
      console.log("💰 这是一个回头客，直接加载旧记忆，省了一笔 API 费！");
      
      setSummary(cachedSummary);
      // 任务结束，Loading 消失，无需联网
    } else {
      // D. 缓存未命中：只能花钱了
      console.log("[Cache] 💨 是新论文，准备召唤学术猫 (API)...");
      
      // 调用 Gemini (这是唯一花 API 额度的地方)
      const newSummary = await generatePaperSummary(textContent);
      
      // 存入缓存，造福下一次
      saveSummaryToCache(fingerprint, newSummary);
      
      setSummary(newSummary);
    }

  } catch (error) {
    console.error("处理失败:", error);
    // 错误处理：如果是解析失败，可能是扫描版
    // 如果是 API 失败，已经在 Service 层拦截过了，这里只做兜底
    alert("喵呜！读取论文失败了，请检查网络或文件格式。");
  } finally {
    setIsLoading(false);
  }
};
  // File Handler
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
    } catch (err) {
      console.error(err);
    } finally {
      setIsSummarizing(false);
    }
  };

  // Debounce Page Change
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedPage(currentPage);
    }, 600);
    return () => clearTimeout(handler);
  }, [currentPage]);

  // Trigger Capture & Pre-fetch Logic
  useEffect(() => {
    if (mode === AppMode.READING) {
      // 1. If current page not translated, trigger capture
      if (!pageTranslations.has(debouncedPage) && !isTranslatingPage) {
        setTriggerCapture(prev => prev + 1);
      } 
      // 2. Background Auto-Scribe: If current page IS done, try to pre-fetch next page
      else if (pageTranslations.has(debouncedPage) && !isTranslatingPage) {
        const nextPage = debouncedPage + 1;
        // Check if next page is already cached, if not, prefetch it
        if (!pageTranslations.has(nextPage)) {
           setPrefetchPage(nextPage);
        }
      }
    }
  }, [debouncedPage, mode, pageTranslations, isTranslatingPage]);

  const processCanvas = async (canvas: HTMLCanvasElement, pageNum: number) => {
    if (pageTranslations.has(pageNum)) return;

    if (pageNum === debouncedPage) setIsTranslatingPage(true);

    try {
      // Downscale
      const MAX_DIMENSION = 1000;
      let width = canvas.width;
      let height = canvas.height;
      let imageBase64 = '';
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = width * scale;
          tempCanvas.height = height * scale;
          const ctx = tempCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
            imageBase64 = tempCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
          } else {
            imageBase64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
          }
      } else {
          imageBase64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      }

      const translation = await translatePageContent(imageBase64);
      // Ensure pageNumber is set correctly
      translation.pageNumber = pageNum;

      setPageTranslations(prev => {
        const newMap = new Map(prev);
        newMap.set(pageNum, translation);
        return newMap;
      });
      
      if (pageNum === prefetchPage) {
        setPrefetchPage(null); // Stop prefetching this specific page
      }

    } catch(e) {
      console.error(e);
      // If main page fails, mark error. 
      if (pageNum === debouncedPage) {
        const errorBlock: ContentBlock = {
            type: 'paragraph',
            en: '',
            cn: '魔法能量紊乱，无法解析卷轴内容...'
        };
        setPageTranslations(prev => {
            const newMap = new Map(prev);
            newMap.set(pageNum, { pageNumber: pageNum, blocks: [errorBlock], glossary: [] });
            return newMap;
        });
      }
    } finally {
      if (pageNum === debouncedPage) setIsTranslatingPage(false);
    }
  };

  const handleMainPageRendered = useCallback((canvas: HTMLCanvasElement, pageNum: number) => {
     // Only process if it matches the current user intent to avoid stale renders
     if (pageNum === debouncedPage) {
       processCanvas(canvas, pageNum);
     }
  }, [debouncedPage]);

  // Callback for the hidden background reader
  const handlePrefetchRendered = useCallback(() => {
    const hiddenContainer = document.getElementById('hidden-prefetch-container');
    if (hiddenContainer && prefetchPage) {
      const canvas = hiddenContainer.querySelector('canvas');
      if (canvas) {
        processCanvas(canvas, prefetchPage);
      }
    }
  }, [prefetchPage]);

  // --- Interaction Handlers ---

  const handleCitationClick = async (id: string) => {
    if (!file) return;
    setIsAnalyzingCitation(true);
    setCitationInfo(null);
    try {
      const info = await analyzeCitation(id, file.base64, file.mimeType);
      setCitationInfo(info);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzingCitation(false);
    }
  };

  const handleEquationClick = async (eq: string) => {
    setIsAnalyzingEquation(true);
    setEquationExplanation(null);
    try {
      const expl = await explainEquation(eq);
      setEquationExplanation(expl);
    } catch(e) {
      console.error(e);
    } finally {
      setIsAnalyzingEquation(false);
    }
  };

  const handleContextSelection = (text: string, action: 'explain' | 'save') => {
    if (action === 'explain') {
      setActiveTab(SidebarTab.CHAT);
      handleSendMessage(`请通俗解释这段话：\n"${text}"`);
    } else if (action === 'save') {
      const newNote: Note = {
        id: Date.now().toString(),
        text: text,
        date: new Date().toLocaleString()
      };
      setNotes(prev => [newNote, ...prev]);
      setActiveTab(SidebarTab.NOTES);
      showToast("已收藏至魔法笔记！");
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!file) return;
    const newUserMsg: ChatMessage = { role: 'user', text };
    setChatMessages(prev => [...prev, newUserMsg]);
    setIsChatting(true);
    
    try {
      let answer = '';

      // 👇 修改核心逻辑：根据 aiModel 状态选择服务
      if (aiModel === 'deepseek') {
        // 调用 DeepSeek (注意：DeepSeek 标准接口不直接传 PDF 文件，这里仅传文本)
        // 如果你想让 DeepSeek 也能读论文，需要先提取 PDF 文本传进去，这里暂时演示纯对话
        const response = await chatWithDeepSeek(text);
        answer = response || "DeepSeek 没有返回内容";
      } else {
        // 调用 Gemini (支持多模态，传 PDF Base64)
        const historyForApi = chatMessages.map(m => ({ role: m.role, text: m.text }));
        answer = await chatWithPaper(historyForApi, text, file.base64, file.mimeType);
      }
      
      setChatMessages(prev => [...prev, { role: 'model', text: answer }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'model', text: "喵？网络似乎不通畅... 请重试", isError: true }]);
    } finally {
      setIsChatting(false);
    }
  };

  const resetApp = () => {
    setFile(null);
    setMode(AppMode.UPLOAD);
    setSummary(null);
    setChatMessages([]);
    setPageTranslations(new Map());
    setTriggerCapture(0);
    setCurrentPage(1);
    setDebouncedPage(1);
    setPrefetchPage(null);
  };

  if (mode === AppMode.UPLOAD) {
    return (
      <div className="min-h-screen bg-[#2c1810] flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Fantasy Background Particles (Simulated) */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{backgroundImage: 'radial-gradient(#DAA520 1px, transparent 1px)', backgroundSize: '20px 20px'}}></div>
        
        <div className="max-w-xl w-full text-center space-y-8 animate-in fade-in duration-700 relative z-10">
          <div>
             <div className="bg-[#8B4513] w-20 h-20 mx-auto flex items-center justify-center mb-6 rpg-border">
              <BookOpenIcon className="text-[#DAA520] w-10 h-10" />
            </div>
            <h1 className="text-4xl font-bold text-[#e8e4d9] mb-3 pixel-font leading-relaxed tracking-wider">Scholar Scroll</h1>
            <p className="text-lg text-[#DAA520] serif italic">研读卷轴 · 解锁古老知识的秘密</p>
          </div>

          <div className="bg-[#e8e4d9] p-10 rpg-border hover:brightness-110 transition-all cursor-pointer group relative">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="space-y-4">
              <div className="w-16 h-16 bg-[#2c1810] rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-300 border-2 border-[#DAA520]">
                <UploadIcon className="w-8 h-8 text-[#DAA520]" />
              </div>
              <p className="font-bold text-lg text-[#2c1810] pixel-font">召唤 PDF 卷轴 (SUMMON PDF)</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // READING MODE
  return (
    <div className={`flex flex-col h-screen overflow-hidden font-sans ${appearance.theme === 'sepia' ? 'bg-[#F4ECD8]' : 'bg-[#2c1810]'}`}>
      
      {/* Hidden Prefetcher */}
      {prefetchPage && file && (
        <div id="hidden-prefetch-container" className="absolute top-0 left-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
             <PDFViewer 
               fileUrl={file.url}
               pageNumber={prefetchPage}
               onPageChange={() => {}}
               onPageRendered={() => handlePrefetchRendered()} 
               triggerCapture={1} // Force capture immediately
             />
        </div>
      )}

      {/* Header */}
      <div className={`h-16 border-b-4 flex items-center px-4 justify-between shrink-0 shadow-lg z-50 ${appearance.theme === 'sepia' ? 'bg-[#e8e4d9] border-[#8B4513]' : 'bg-[#2c1810] border-[#8B4513]'}`}>
         <div className="flex items-center gap-3">
           <div className="bg-[#DAA520] p-1 border-2 border-[#e8e4d9]">
             <BookOpenIcon className="w-6 h-6 text-[#2c1810]" />
           </div>
           <span className={`font-bold pixel-font text-xs tracking-widest hidden md:block ${appearance.theme === 'sepia' ? 'text-[#2c1810]' : 'text-[#e8e4d9]'}`}>SCHOLAR SCROLL</span>
           <span className="h-6 w-1 bg-[#8B4513] mx-2"></span>
           <span className="text-xs font-bold text-[#DAA520] truncate max-w-[200px] pixel-font">{file?.name}</span>
         </div>

         <div className="flex gap-2 items-center">
           {/* Appearance Settings Button */}
           <div className="relative">
             <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded border-2 ${showSettings ? 'bg-[#DAA520] text-[#2c1810]' : 'bg-transparent text-[#DAA520] border-[#DAA520] hover:bg-[#DAA520]/20'}`}
             >
               <SettingsIcon className="w-5 h-5" />
             </button>
             
             {showSettings && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-[#e8e4d9] border-4 border-[#2c1810] shadow-xl p-4 z-50 rounded animate-in fade-in zoom-in-95 duration-100">
                  
                  {/* 👇 新增：模型切换区域 */}
                  <div className="mb-4 border-b-2 border-[#8B4513]/20 pb-4">
                    <h4 className="pixel-font text-xs font-bold mb-2 text-[#2c1810]">AI 模型 (MODEL)</h4>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setAiModel('gemini')}
                        className={`flex-1 py-1 text-xs border-2 font-bold transition-all ${aiModel === 'gemini' ? 'bg-[#2c1810] text-[#DAA520] border-[#DAA520]' : 'border-[#8B4513] text-[#8B4513] opacity-50'}`}
                      >
                        Gemini
                      </button>
                      <button 
                        onClick={() => setAiModel('deepseek')}
                        className={`flex-1 py-1 text-xs border-2 font-bold transition-all ${aiModel === 'deepseek' ? 'bg-[#000080] text-[#fff] border-[#0000ff]' : 'border-[#8B4513] text-[#8B4513] opacity-50'}`}
                      >
                        DeepSeek
                      </button>
                    </div>
                  </div>
                  {/* 👆 新增结束 */}
              
                 <h4 className="pixel-font text-xs font-bold mb-4 text-[#2c1810]">外观 (APPEARANCE)</h4>
                 
                 
                 {/* Theme Toggle */}
                 <div className="mb-4">
                   <label className="text-xs font-bold text-[#8B4513] block mb-2">阅读模式</label>
                   <div className="flex gap-2">
                     <button 
                       onClick={() => setAppearance(p => ({...p, theme: 'sepia'}))}
                       className={`flex-1 py-1 text-xs border-2 ${appearance.theme === 'sepia' ? 'bg-[#F4ECD8] border-[#8B4513] text-[#2c1810] font-bold' : 'border-[#ccc] text-gray-400'}`}
                     >
                       羊皮纸
                     </button>
                     <button 
                       onClick={() => setAppearance(p => ({...p, theme: 'dark'}))}
                       className={`flex-1 py-1 text-xs border-2 ${appearance.theme === 'dark' ? 'bg-[#2c1810] border-[#DAA520] text-[#DAA520] font-bold' : 'border-[#ccc] text-gray-400'}`}
                     >
                       暗夜
                     </button>
                   </div>
                 </div>

                 {/* Font Size */}
                 <div className="mb-4">
                   <label className="text-xs font-bold text-[#8B4513] block mb-2">字号 (SIZE): {appearance.fontSize}px</label>
                   <input 
                     type="range" min="12" max="24" step="1" 
                     value={appearance.fontSize}
                     onChange={(e) => setAppearance(p => ({...p, fontSize: parseInt(e.target.value)}))}
                     className="w-full accent-[#8B4513]" 
                   />
                 </div>

                 {/* Font Family */}
                 <div className="mb-4">
                   <label className="text-xs font-bold text-[#8B4513] block mb-2">字体 (FONT)</label>
                   <div className="flex gap-2">
                      <button 
                       onClick={() => setAppearance(p => ({...p, fontFamily: 'serif'}))}
                       className={`flex-1 py-1 text-xs border-2 font-serif ${appearance.fontFamily === 'serif' ? 'bg-[#8B4513] text-[#e8e4d9] border-[#2c1810]' : 'border-[#ccc] text-gray-500'}`}
                     >
                       宋体
                     </button>
                     <button 
                       onClick={() => setAppearance(p => ({...p, fontFamily: 'sans'}))}
                       className={`flex-1 py-1 text-xs border-2 font-sans ${appearance.fontFamily === 'sans' ? 'bg-[#8B4513] text-[#e8e4d9] border-[#2c1810]' : 'border-[#ccc] text-gray-500'}`}
                     >
                       黑体
                     </button>
                   </div>
                 </div>

                 {/* Shortcuts Guide */}
                 <div className="pt-4 border-t-2 border-[#8B4513]/20">
                    <h5 className="font-bold text-[10px] mb-2 text-[#2c1810]">快捷键 (SHORTCUTS)</h5>
                    <ul className="text-[10px] space-y-1 pixel-font text-[#5c4033]">
                      <li><span className="font-bold">← / →</span> : 翻页</li>
                      <li><span className="font-bold">Space</span> : 自动滚动</li>
                      <li><span className="font-bold">D</span> : 切换日/夜</li>
                      <li><span className="font-bold">T</span> : 切换侧栏</li>
                    </ul>
                 </div>
               </div>
             )}
           </div>

           {/* Tabs */}
           {['DUAL', SidebarTab.SUMMARY, SidebarTab.CHAT, SidebarTab.NOTES].map((tab) => (
             <button 
               key={tab}
               onClick={() => setActiveTab(tab as any)}
               className={`px-3 py-2 text-[10px] font-bold transition-all pixel-font border-2 ${activeTab === tab ? 'bg-[#DAA520] text-[#2c1810] border-[#e8e4d9]' : 'bg-[#2c1810] text-[#DAA520] border-[#8B4513] hover:bg-[#3e2723]'}`}
             >
               {tab === 'DUAL' ? 'READ' : tab}
             </button>
           ))}
         </div>

         <button onClick={resetApp} className="text-[#e8e4d9] hover:text-red-400 transition-colors p-2">
           <XIcon className="w-6 h-6" />
         </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* LEFT: PDF Viewer */}
        <div 
          className="h-full relative bg-[#5c4033]"
          style={{ width: `${leftWidth}%` }}
        >
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

        {/* Resizer Handle */}
        <div 
           className="w-2 bg-[#2c1810] border-l border-r border-[#8B4513] cursor-col-resize hover:bg-[#DAA520] transition-colors flex items-center justify-center z-40"
           onMouseDown={startResizing}
        >
          <GripVerticalIcon className="w-4 h-4 text-[#8B4513]" />
        </div>

        {/* RIGHT: AI Panels */}
        <div 
           className="h-full relative"
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
             <div className="p-6 h-full overflow-y-auto bg-[#e8e4d9]">
               <SummaryView summary={summary} isLoading={isSummarizing} error={null} />
             </div>
          )}
          
          {activeTab === SidebarTab.CHAT && (
             <ChatInterface messages={chatMessages} onSendMessage={handleSendMessage} isSending={isChatting} />
          )}

          {activeTab === SidebarTab.NOTES && (
            <div className="p-6 h-full overflow-y-auto bg-[#e8e4d9] space-y-4">
              <h3 className="font-bold pixel-font text-[#2c1810] border-b-2 border-[#8B4513] pb-2">魔法笔记 (Saved Notes)</h3>
              {notes.length === 0 ? (
                <div className="text-center text-gray-500 mt-10 text-sm">暂无笔记，请在左侧 PDF 划词收藏。</div>
              ) : (
                notes.map(note => (
                  <div key={note.id} className="bg-[#fffef0] p-3 border-2 border-[#8B4513] shadow-sm rounded">
                    <p className="text-[#2c1810] serif text-sm mb-2">{note.text}</p>
                    <p className="text-[10px] text-[#8B4513] text-right">{note.date}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Shortcuts Toast Bubble */}
        {toastMessage && (
          <div className="absolute bottom-8 right-8 z-50 animate-bounce">
             <div className="relative bg-[#2c1810] text-[#DAA520] p-3 rounded-lg border-2 border-[#DAA520] shadow-xl">
               <span className="text-2xl absolute -top-4 -left-2">🐱</span>
               <p className="pixel-font text-xs font-bold pl-4">{toastMessage}</p>
               {/* Bubble Tail */}
               <div className="absolute bottom-0 right-4 translate-y-1/2 rotate-45 w-3 h-3 bg-[#2c1810] border-r-2 border-b-2 border-[#DAA520]"></div>
             </div>
          </div>
        )}

        {/* Modals / Overlays */}
        
        {/* Citation Oracle Modal */}
        {(isAnalyzingCitation || citationInfo) && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
            <div className="bg-[#e8e4d9] w-full max-w-md border-4 border-[#2c1810] shadow-2xl p-0 relative">
               <div className="bg-[#2c1810] text-[#DAA520] p-2 flex justify-between items-center">
                 <h3 className="pixel-font text-xs">真视之眼 (THE ORACLE)</h3>
                 <button onClick={() => { setCitationInfo(null); setIsAnalyzingCitation(false); }} className="text-[#e8e4d9]">X</button>
               </div>
               <div className="p-6">
                 {isAnalyzingCitation ? (
                   <div className="text-center py-8">
                     <div className="inline-block animate-spin text-2xl mb-2">🔮</div>
                     <p className="pixel-font text-xs text-[#2c1810]">正在检索上古卷轴...</p>
                   </div>
                 ) : (
                   <div className="space-y-4">
                     <div className="flex justify-between items-start gap-4">
                        <h4 className="font-bold text-lg text-[#2c1810] serif leading-tight">{citationInfo?.title}</h4>
                        <span className={`shrink-0 px-2 py-1 text-[10px] border-2 font-bold pixel-font ${citationInfo?.status === 'MUST_READ' ? 'bg-[#8B4513] text-[#DAA520] border-[#DAA520]' : 'bg-[#e8e4d9] text-[#2c1810] border-[#2c1810]'}`}>
                          {citationInfo?.status === 'MUST_READ' ? '必读圣经' : '普通文献'}
                        </span>
                     </div>
                     <p className="text-sm text-[#5c4033] italic serif">{citationInfo?.year}</p>
                     <div className="bg-[#f5f2e9] p-3 border-2 border-[#2c1810] text-sm text-[#2c1810] serif leading-relaxed">
                       {citationInfo?.abstract}
                     </div>
                   </div>
                 )}
               </div>
            </div>
          </div>
        )}

        {/* Equation Magic Lens Modal */}
        {(isAnalyzingEquation || equationExplanation) && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 p-4">
            <div className="bg-[#2c1810] border-t-4 border-l-4 border-r-4 border-[#DAA520] shadow-2xl p-0 relative rounded-t-lg">
               <div className="flex justify-between items-center p-2 border-b border-[#DAA520]/30">
                 <h3 className="text-[#DAA520] pixel-font text-xs">魔镜解析 (MAGIC LENS)</h3>
                 <button onClick={() => { setEquationExplanation(null); setIsAnalyzingEquation(false); }} className="text-[#e8e4d9] hover:text-[#DAA520]">CLOSE</button>
               </div>
               <div className="p-4 min-h-[150px] max-h-[300px] overflow-y-auto">
                 {isAnalyzingEquation ? (
                    <div className="text-[#e8e4d9] pixel-font text-xs animate-pulse">正在解构符文...</div>
                 ) : (
                    <div className="prose prose-invert prose-sm max-w-none text-[#e8e4d9] serif">
                       <ReactMarkdown>{equationExplanation || ''}</ReactMarkdown>
                    </div>
                 )}
               </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;
