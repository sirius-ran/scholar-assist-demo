import React, { useState, useEffect, useRef, forwardRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, LoaderIcon, InfoIcon, StarIcon } from './IconComponents';

// Configure PDF.js worker from CDN for stability
pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  fileUrl: string;
  pageNumber: number;
  onPageChange: (page: number) => void;
  onPageRendered: (pageCanvas: HTMLCanvasElement, pageNum: number) => void;
  highlightText?: string | null;
  triggerCapture?: number;
  onTextSelected?: (text: string, action: 'explain' | 'save') => void;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PDFViewer = forwardRef<HTMLDivElement, PDFViewerProps>(({ 
  fileUrl, 
  pageNumber, 
  onPageChange, 
  onPageRendered,
  highlightText,
  triggerCapture,
  onTextSelected
}, ref) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.2); 
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [textLayerReady, setTextLayerReady] = useState(false);

  // Context Menu & Link State
  const [selectionMenu, setSelectionMenu] = useState<{x: number, y: number, text: string} | null>(null);
  const [internalLinkTooltip, setInternalLinkTooltip] = useState<{x: number, y: number, id: string} | null>(null);
  const [externalLinkConfirm, setExternalLinkConfirm] = useState<string | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const changeScale = (delta: number) => {
    setScale(prevScale => Math.min(Math.max(0.6, prevScale + delta), 2.5));
  };

  const captureCanvas = () => {
    if (!pageContainerRef.current) return;
    const pageDiv = pageContainerRef.current.querySelector(`.react-pdf__Page[data-page-number="${pageNumber}"]`);
    if (!pageDiv) return;
    const canvas = pageDiv.querySelector('canvas');
    if (canvas) {
      onPageRendered(canvas, pageNumber);
    }
  };

  // Trigger capture via prop signal
  useEffect(() => {
    if ((triggerCapture || 0) > 0) {
      // Small delay to ensure render is complete
      const timer = setTimeout(() => {
        captureCanvas();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [triggerCapture, pageNumber]);

  // Reset text layer state when page changes
  useEffect(() => {
    setTextLayerReady(false);
    setHighlights([]);
  }, [pageNumber, scale]);


  // --- SMART BBOX HIGHLIGHTING ---
  useEffect(() => {
    // Basic Guard
    if (!highlightText || highlightText.length < 5 || !textLayerReady || !pageContainerRef.current) {
      setHighlights([]);
      return;
    }

    const calculateHighlights = () => {
      const textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) return;

      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        textNodes.push(node as Text);
      }
      
      if (textNodes.length === 0) return;

      // 1. Build Map
      let normalizedPdfText = "";
      const charMap: { node: Text; index: number }[] = [];
      
      const isAlphaNumeric = (char: string) => /[a-zA-Z0-9\u4e00-\u9fa5]/.test(char);

      for (const txtNode of textNodes) {
        const str = txtNode.textContent || "";
        for (let i = 0; i < str.length; i++) {
           const char = str[i];
           if (isAlphaNumeric(char)) {
             normalizedPdfText += char.toLowerCase();
             charMap.push({ node: txtNode, index: i });
           }
        }
      }
      
      // 2. Prepare Query
      const normalizedQuery = highlightText.split('').filter(isAlphaNumeric).join('').toLowerCase();
      if (normalizedQuery.length < 5) return; 

      // 3. Match Logic (Exact OR Anchor)
      let startIndex = normalizedPdfText.indexOf(normalizedQuery);
      let endIndex = -1;

      if (startIndex !== -1) {
         // Exact match found
         endIndex = startIndex + normalizedQuery.length - 1;
      } else {
         // Fallback: Anchor Matching (Head & Tail)
         const ANCHOR_LEN = Math.min(30, Math.floor(normalizedQuery.length / 2));
         
         if (ANCHOR_LEN > 5) {
            const head = normalizedQuery.substring(0, ANCHOR_LEN);
            const tail = normalizedQuery.substring(normalizedQuery.length - ANCHOR_LEN);
            
            const headIndex = normalizedPdfText.indexOf(head);
            
            if (headIndex !== -1) {
               // Look for tail AFTER head, within reasonable distance (length * 1.5)
               const searchStart = headIndex + ANCHOR_LEN;
               const maxDistance = normalizedQuery.length * 1.5;
               const tailIndex = normalizedPdfText.indexOf(tail, searchStart);
               
               // Ensure tail is found and not too far away
               if (tailIndex !== -1 && (tailIndex - headIndex) < maxDistance) {
                  startIndex = headIndex;
                  endIndex = tailIndex + tail.length - 1;
               }
            }
         }
      }
      
      if (startIndex === -1 || endIndex === -1) {
        setHighlights([]);
        return;
      }
      
      if (!charMap[startIndex] || !charMap[endIndex]) return;
      
      const startNodeData = charMap[startIndex];
      const endNodeData = charMap[endIndex];
      
      const range = document.createRange();
      try {
        range.setStart(startNodeData.node, startNodeData.index);
        range.setEnd(endNodeData.node, endNodeData.index + 1);
        
        const rects = range.getClientRects();
        const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
        const pageRect = pageElement?.getBoundingClientRect();
        
        if (!pageRect) return;

        const newHighlights: HighlightRect[] = [];
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width < 1 || r.height < 1) continue;
          if (r.width > pageRect.width * 0.9 && r.height > pageRect.height * 0.9) continue; // Filter full page

          newHighlights.push({
            left: r.left - pageRect.left,
            top: r.top - pageRect.top,
            width: r.width,
            height: r.height
          });
        }
        setHighlights(newHighlights);

        if (newHighlights.length > 0) {
           startNodeData.node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

      } catch (e) {
        console.error("Highlight calculation error:", e);
        setHighlights([]);
      }
    };

    const timer = setTimeout(calculateHighlights, 50);
    return () => clearTimeout(timer);

  }, [highlightText, textLayerReady, pageNumber, scale]);


  // --- LINKS & INTERACTION ---
  const handleAnnotationClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('http') || href.startsWith('mailto')) {
        setExternalLinkConfirm(href);
      } else {
        const rect = anchor.getBoundingClientRect();
        setInternalLinkTooltip({
           x: rect.left + rect.width / 2,
           y: rect.top,
           id: "Citation/Ref" 
        });
        setTimeout(() => setInternalLinkTooltip(null), 2500);
      }
    }
  };

  // --- MENU HANDLER ---
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !pageContainerRef.current) {
        setSelectionMenu(null);
        return;
      }
      const text = selection.toString().trim();
      // Use standard contains check
      if (text.length > 0 && pageContainerRef.current.contains(selection.anchorNode)) {
         const range = selection.getRangeAt(0);
         const rect = range.getBoundingClientRect();
         setSelectionMenu({
           x: rect.left + (rect.width / 2),
           y: rect.top - 10,
           text: text
         });
      } else {
        setSelectionMenu(null);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);


  return (
    <div className="flex flex-col h-full bg-[#5c4033] relative">
      {/* Control Bar */}
      <div className="h-12 bg-[#2c1810] text-[#DAA520] flex items-center justify-between px-4 border-b border-[#8B4513] shadow-md z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-[#2c1810] border-2 border-[#8B4513] p-1">
            <button 
              onClick={() => onPageChange(pageNumber - 1)} 
              disabled={pageNumber <= 1}
              className="p-1 hover:bg-[#8B4513] text-[#e8e4d9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span className="mx-3 min-w-[60px] text-center font-bold text-xs pixel-font">
              {numPages ? `${pageNumber}/${numPages}` : '--'}
            </span>
            <button 
              onClick={() => onPageChange(pageNumber + 1)} 
              disabled={pageNumber >= (numPages || 0)}
              className="p-1 hover:bg-[#8B4513] text-[#e8e4d9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center bg-[#2c1810] border-2 border-[#8B4513] p-1">
           <button onClick={() => changeScale(-0.1)} className="p-1 hover:bg-[#8B4513] text-[#e8e4d9]"><ZoomOutIcon className="w-4 h-4" /></button>
            <span className="mx-2 min-w-[40px] text-center font-bold text-xs pixel-font">{Math.round(scale * 100)}%</span>
            <button onClick={() => changeScale(0.1)} className="p-1 hover:bg-[#8B4513] text-[#e8e4d9]"><ZoomInIcon className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Main PDF Scroll Area */}
      <div 
        className="flex-1 overflow-auto flex justify-center p-4 relative bg-[#5c4033] scroll-smooth" 
        ref={(node) => {
            pageContainerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
      >
        <div className="relative h-fit shadow-2xl border-4 border-[#2c1810] bg-white" onClick={handleAnnotationClick}>
           <Document
              file={fileUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center h-96 w-full text-[#DAA520]">
                  <LoaderIcon className="w-8 h-8 animate-spin" />
                </div>
              }
              error={<div className="text-red-500 p-4">Error loading Scroll</div>}
            >
              <Page 
                pageNumber={pageNumber} 
                scale={scale}
                renderTextLayer={true} 
                renderAnnotationLayer={true} 
                className="bg-white"
                onRenderSuccess={() => {
                  // Wait a bit for canvas to be fully ready before signal
                  setTimeout(captureCanvas, 300);
                }}
                onGetTextSuccess={() => setTextLayerReady(true)}
              />
              
              {/* Highlight Overlay Layer (z-10) */}
              <div className="absolute inset-0 pointer-events-none z-10">
                {highlights.map((h, i) => (
                  <div
                    key={i}
                    className="absolute bg-yellow-400 mix-blend-multiply opacity-50 transition-all duration-300"
                    style={{
                      left: h.left,
                      top: h.top,
                      width: h.width,
                      height: h.height
                    }}
                  />
                ))}
              </div>
            </Document>
        </div>

        {/* Context Menu */}
        {selectionMenu && (
          <div 
            className="fixed z-50 transform -translate-x-1/2 -translate-y-full mb-2 flex gap-1 animate-in fade-in zoom-in duration-200"
            style={{ left: selectionMenu.x, top: selectionMenu.y }}
          >
             <div className="bg-[#2c1810] border-2 border-[#DAA520] p-1 rounded-lg shadow-xl flex gap-2">
                <button 
                  onClick={() => onTextSelected?.(selectionMenu.text, 'explain')}
                  className="px-3 py-1.5 bg-[#8B4513] hover:bg-[#DAA520] text-[#e8e4d9] hover:text-[#2c1810] text-xs font-bold rounded flex items-center gap-1 pixel-font transition-colors"
                >
                  <InfoIcon className="w-3 h-3" /> 小猫解释
                </button>
                <button 
                  onClick={() => onTextSelected?.(selectionMenu.text, 'save')}
                  className="px-3 py-1.5 bg-[#8B4513] hover:bg-[#DAA520] text-[#e8e4d9] hover:text-[#2c1810] text-xs font-bold rounded flex items-center gap-1 pixel-font transition-colors"
                >
                  <StarIcon className="w-3 h-3" /> 收藏金句
                </button>
             </div>
             <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#DAA520]"></div>
          </div>
        )}

        {/* Internal Link Tooltip */}
        {internalLinkTooltip && (
           <div 
             className="fixed z-50 transform -translate-x-1/2 -translate-y-full mb-2"
             style={{ left: internalLinkTooltip.x, top: internalLinkTooltip.y }}
           >
              <div className="bg-[#e8e4d9] text-[#2c1810] px-3 py-2 rounded border-2 border-[#2c1810] shadow-lg text-xs pixel-font font-bold animate-in fade-in slide-in-from-bottom-2">
                 内部引用 (Internal Reference)
                 <div className="text-[10px] font-normal text-gray-600 mt-1">跳转预览暂未实装</div>
              </div>
           </div>
        )}

        {/* External Link Confirm Modal */}
        {externalLinkConfirm && (
           <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-[#e8e4d9] border-4 border-[#2c1810] p-6 max-w-sm w-full shadow-2xl relative animate-in fade-in zoom-in">
                 <h3 className="pixel-font font-bold text-[#2c1810] mb-4">传送门开启 (PORTAL OPENING)</h3>
                 <p className="serif text-sm mb-4">您即将离开卷轴，前往外部世界：</p>
                 <p className="font-mono text-xs bg-white p-2 border border-gray-300 mb-6 break-all max-h-20 overflow-y-auto">{externalLinkConfirm}</p>
                 <div className="flex justify-end gap-2">
                    <button onClick={() => setExternalLinkConfirm(null)} className="px-4 py-2 border-2 border-[#2c1810] hover:bg-gray-200 pixel-font text-xs">取消 (STAY)</button>
                    <button onClick={() => { window.open(externalLinkConfirm, '_blank'); setExternalLinkConfirm(null); }} className="px-4 py-2 bg-[#DAA520] border-2 border-[#2c1810] hover:brightness-110 pixel-font text-xs font-bold">前往 (WARP)</button>
                 </div>
              </div>
           </div>
        )}

      </div>
    </div>
  );
});

export default PDFViewer;
