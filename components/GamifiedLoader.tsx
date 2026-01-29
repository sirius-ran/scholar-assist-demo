import React, { useState, useEffect } from 'react';

const LOADING_MESSAGES = [
  "正在与审稿人搏斗... (Fighting Reviewer #2...)",
  "正在解析复杂的 LaTeX 咒语... (Parsing LaTeX spells...)",
  "猫咪正在查阅字典... (Cat is checking the dictionary...)",
  "正在给论文施加‘易读’魔法... (Casting 'Readable' buff...)",
  "正在提取核心知识晶体... (Mining knowledge crystals...)",
  "喵？这个公式有点难啃... (Meow? This formula is chewy...)",
  "正在召唤学术先贤的灵魂... (Summoning academic spirits...)"
];

const ScholarCatSVG = () => (
  <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-xl">
    <defs>
      <linearGradient id="bookCover" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#5d4037" />
        <stop offset="100%" stopColor="#4e342e" />
      </linearGradient>
    </defs>
    
    {/* 阴影 */}
    <ellipse cx="50" cy="95" rx="30" ry="5" fill="#000" opacity="0.2" />
    
    {/* 书本底座 */}
    <path d="M20,85 Q20,90 25,90 L75,90 Q80,90 80,85 L80,75 Q80,80 75,80 L25,80 Q20,80 20,75 Z" fill="#3e2723" />
    <path d="M22,78 L78,78 L78,88 L22,88 Z" fill="#fff8e1" /> {/* 书页 */}
    <path d="M20,75 Q50,85 80,75 L80,85 Q50,95 20,85 Z" fill="url(#bookCover)" /> {/* 封面 */}

    {/* 猫身体 */}
    <path d="M35,75 Q30,40 50,30 Q70,40 65,75 Z" fill="#2c1810" /> 
    
    {/* 耳朵 */}
    <path d="M38,35 L30,20 L48,32 Z" fill="#2c1810" />
    <path d="M62,35 L70,20 L52,32 Z" fill="#2c1810" />
    
    {/* 眼镜 (金色) */}
    <g stroke="#ffd700" strokeWidth="1.5" fill="none" opacity="0.9">
       <circle cx="43" cy="45" r="4.5" />
       <path d="M47.5,45 L52.5,45" />
       <circle cx="57" cy="45" r="4.5" />
    </g>

    {/* 眼睛 (眨眼动画通过 CSS 实现) */}
    <g className="cat-eye-blink">
      <circle cx="43" cy="45" r="1.5" fill="#fff" />
      <circle cx="57" cy="45" r="1.5" fill="#fff" />
    </g>

    {/* 魔法粒子 */}
    <circle cx="50" cy="25" r="2" fill="#ffd700" className="animate-pulse" style={{animationDuration: '2s'}} />
    <circle cx="20" cy="40" r="1" fill="#ffd700" className="animate-pulse" style={{animationDuration: '1.5s'}} />
    <circle cx="80" cy="50" r="1.5" fill="#ffd700" className="animate-pulse" style={{animationDuration: '2.5s'}} />
  </svg>
);

const GamifiedLoader: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    // 进度条逻辑保持不变
    const interval = setInterval(() => {
      setProgress(prev => {
        const remaining = 100 - prev;
        const step = Math.max(remaining * 0.02, 0.05); 
        const next = prev + step;
        return next >= 99.5 ? 99.5 : next;
      });
    }, 100);

    const msgInterval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
    }, 2500);

    return () => {
      clearInterval(interval);
      clearInterval(msgInterval);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 text-[#2c1810] bg-[#fdfbf7]/50 relative overflow-hidden">
      
      {/* 注入必要的 CSS 动画 */}
      <style>{`
        @keyframes cat-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes blink {
          0%, 48%, 52%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.1); }
        }
        .animate-cat-float {
          animation: cat-float 3s ease-in-out infinite;
        }
        .cat-eye-blink {
          transform-origin: center;
          animation: blink 4s infinite;
        }
        .magic-shimmer {
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-20deg);
        }
      `}</style>

      {/* SVG Cat Container */}
      <div className="mb-6 relative w-32 h-32 animate-cat-float">
        {/* 背景光晕 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-yellow-500/10 rounded-full blur-xl animate-pulse"></div>
        <ScholarCatSVG />
      </div>

      <div className="w-72 max-w-full mb-6">
        {/* Magic Progress Bar */}
        <div className="relative">
          <div className="flex justify-between items-end mb-1 px-1">
             <span className="pixel-font text-[10px] text-[#5d4037] font-bold tracking-widest">KNOWLEDGE</span>
             <span className="pixel-font text-[10px] text-[#8B4513] font-bold">{Math.floor(progress)}%</span>
          </div>
          
          <div className="h-4 bg-[#2c1810] p-[2px] rounded-sm shadow-md border border-[#5d4037]">
             <div className="h-full bg-[#3e2723] rounded-[1px] relative overflow-hidden">
                {/* 进度条本体 */}
                <div 
                  className="h-full bg-gradient-to-r from-[#b8860b] via-[#ffd700] to-[#b8860b] transition-all duration-200 ease-out relative"
                  style={{ width: `${Math.min(100, progress)}%` }}
                >
                  {/* 扫光效果 */}
                  <div className="absolute top-0 left-0 w-full h-full magic-shimmer animate-[shimmer_2s_infinite]"></div>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* Loading Text */}
      <div className="h-8 flex items-center justify-center">
        <p className="pixel-font text-[10px] md:text-xs text-center font-bold text-[#5d4037] animate-pulse px-4 leading-relaxed">
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>
      
      {/* Footer Tip */}
      <p className="mt-8 text-[10px] font-serif italic text-[#8B4513]/60 border-t border-[#8B4513]/20 pt-2 px-8">
        Tip: Press 'SPACE' to auto-scroll...
      </p>
    </div>
  );
};

export default GamifiedLoader;
