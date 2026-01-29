// src/components/UI.tsx
import React from 'react';

// 1. 魔法卡片容器 (统一的 RPG 边框风格)
export const MagicCard = ({ children, title, className = "", onClose }: any) => (
  <div className={`relative border-4 border-rpg-dark bg-rpg-paperDark shadow-[4px_4px_0_0_#2c1810] ${className}`}>
    {/* 装饰性四角 */}
    <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-rpg-gold opacity-50 pointer-events-none"></div>
    <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-rpg-gold opacity-50 pointer-events-none"></div>
    <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-rpg-gold opacity-50 pointer-events-none"></div>
    <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-rpg-gold opacity-50 pointer-events-none"></div>

    {/* 标题栏 */}
    {title && (
      <div className="flex justify-between items-center bg-rpg-dark text-rpg-gold p-2 border-b-2 border-rpg-brown mb-2">
        <h3 className="pixel-font text-xs tracking-wider">{title}</h3>
        {onClose && (
          <button onClick={onClose} className="hover:text-white transition-colors">✕</button>
        )}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

// 2. 伴读猫咪 (悬浮交互组件)
export const ScholarCatMascot = ({ mood, message, onClick }: { mood: string, message?: string | null, onClick?: () => void }) => {
  const getAvatar = () => {
    switch(mood) {
      case 'THINKING': return '🔮';
      case 'READING': return '🧐';
      case 'SLEEPING': return '💤';
      case 'ERROR': return '🙀';
      default: return '🐱';
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end pointer-events-none">
      {/* 气泡消息 */}
      {message && (
        <div className="mb-3 mr-4 bg-rpg-paper border-2 border-rpg-dark p-3 rounded-lg shadow-xl max-w-xs animate-bounce-slight pointer-events-auto relative">
          <p className="pixel-font text-xs text-rpg-dark leading-relaxed">{message}</p>
          <div className="absolute -bottom-2 right-6 w-4 h-4 bg-rpg-paper border-b-2 border-r-2 border-rpg-dark rotate-45"></div>
        </div>
      )}

      {/* 头像本体 */}
      <div onClick={onClick} className="pointer-events-auto cursor-pointer group relative hover:scale-110 transition-transform duration-200">
         <div className="w-16 h-16 bg-rpg-dark rounded-full border-4 border-rpg-gold shadow-[0_0_15px_rgba(218,165,32,0.5)] flex items-center justify-center overflow-hidden">
            <span className="text-4xl filter drop-shadow-md">{getAvatar()}</span>
         </div>
         {mood === 'THINKING' && (
           <div className="absolute inset-0 border-2 border-rpg-gold rounded-full animate-ping opacity-50"></div>
         )}
         <div className="absolute -bottom-2 -left-2 bg-rpg-gold text-rpg-dark text-[8px] px-1 border border-rpg-dark pixel-font font-bold">LV.99</div>
      </div>
    </div>
  );
};

// 3. 像素按钮
export const RpgButton = ({ children, active, onClick, className = "" }: any) => (
  <button 
    onClick={onClick}
    className={`px-3 py-2 text-[10px] font-bold transition-all pixel-font border-2 shadow-[2px_2px_0_0_#2c1810] active:translate-y-[2px] active:shadow-none ${
      active 
      ? 'bg-rpg-gold text-rpg-dark border-rpg-paper' 
      : 'bg-rpg-dark text-rpg-gold border-rpg-brown hover:bg-[#3e2723]'
    } ${className}`}
  >
    {children}
  </button>
);
