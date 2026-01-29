import { PaperSummary, PageTranslation, ContentBlock, CitationInfo } from "../types";

// ================= 配置区域 =================
const API_KEY = import.meta.env.VITE_PROXY_API_KEY;
const BASE_URL = import.meta.env.VITE_PROXY_BASE_URL; 
const MODEL_NAME = '[贩子死妈]gemini-3-flash-preview'; 

// 检查配置 (仅在控制台提示，不弹窗)
if (!API_KEY || !BASE_URL) {
  console.error("❌ API 配置缺失！请在 .env 中设置 API Key 和 Base URL");
}

// ================= 工具函数 =================

/**
 * 通用 Fetch 请求封装
 */
async function callProxyApi(messages: any[], jsonMode = false) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${API_KEY}`
  };

  const body: any = {
    model: MODEL_NAME,
    messages: messages,
    stream: false,
    temperature: 0.7
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch('/api/proxy', {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      // 这里的 Error 只会在控制台看到，不会直接展示给用户
      throw new Error(`Service Error ${response.status}: ${errData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    // 增加空值检查，防止 crash
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error("服务返回了空数据");
    }
    
    return data.choices[0].message.content;

  } catch (error) {
    console.error("Service Request Failed:", error);
    throw error;
  }
}

/**
 * 清洗 JSON 字符串
 */
function cleanJson(text: string): string {
  if (!text) return "{}";
  // 移除 Markdown 标记，防止解析失败
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ================= 核心业务函数 =================

/**
 * 1. 生成论文摘要
 */
// ... (之前的 import 和 callProxyApi 保持不变)

/**
 * 1. 生成论文摘要 (基于全文文本)
 */
export const generatePaperSummary = async (fullPaperText: string): Promise<PaperSummary> => {
  
  // 1. 检查文本长度，如果完全没提取到，直接报错
  if (!fullPaperText || fullPaperText.length < 100) {
      throw new Error("PDF 内容提取为空，可能文件是纯图片扫描版？");
  }

  const prompt = `
    Role: You are the pixel library guardian "Scholar Cat" (学术猫).
    Task: Analyze the full content of this academic paper and generate a "Magic Item Appraisal Report".
    
    Input: The user has provided the parsed text of the PDF below.
    
    Output JSON ONLY with this structure:
    {
      "title": "Paper Title (Chinese)",
      "tags": ["Tag1", "Tag2", "Tag3"],
      "tldr": {
        "painPoint": "The problem (metaphor, <30 words)",
        "solution": "The method (metaphor, <30 words)",
        "effect": "The result (stats, <30 words)"
      },
      "methodology": [
        { "step": "Step Name", "desc": "Description" }
      ],
      "takeaways": ["Point 1", "Point 2", "Point 3"]
    }

    --- BEGIN PAPER CONTENT ---
    ${fullPaperText}
    --- END PAPER CONTENT ---
  `;

  // 构造纯文本消息 (不再用 image_url)
  const messages = [
    {
      role: "user",
      content: prompt 
    }
  ];

  try {
    // 复用之前的反代调用函数
    const text = await callProxyApi(messages, true);
    return JSON.parse(cleanJson(text)) as PaperSummary;
  } catch (error) {
    console.error("Summary generation failed:", error);
    // 返回兜底数据
    return {
      title: "解读中断",
      tags: ["系统维护中"],
      tldr: { 
        painPoint: "文本量太大或提取失败", 
        solution: "请尝试刷新重试", 
        effect: "暂无数据" 
      },
      methodology: [],
      takeaways: []
    };
  }
};


/**
 * 2. 翻译页面
 */
export const translatePageContent = async (base64Image: string): Promise<PageTranslation> => {
  const prompt = `
    Analyze this image of an academic paper page.
    1. Extract content into 'blocks' (translate EN to CN).
    2. Extract 'glossary' terms (3-5 terms).
    
    Output JSON ONLY:
    {
      "blocks": [
        { "type": "paragraph|heading|list|equation|figure", "en": "original text", "cn": "translated text" }
      ],
      "glossary": [
        { "term": "Term", "definition": "Chinese Definition" }
      ]
    }
  `;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${base64Image}` }
        }
      ]
    }
  ];

  try {
    const text = await callProxyApi(messages, true);
    const data = JSON.parse(cleanJson(text));
    return {
      pageNumber: 0,
      blocks: data.blocks || [],
      glossary: data.glossary || []
    };
  } catch (error) {
    // ✅ 修改：不再提“反代”或“识图失败”
    return {
      pageNumber: 0,
      blocks: [{ type: "paragraph", en: "Network Error", cn: "暂时无法获取翻译内容，请检查网络连接。" }],
      glossary: []
    };
  }
};

/**
 * 3. 聊天功能
 */
export const chatWithPaper = async (
  history: { role: 'user' | 'model', text: string }[],
  currentMessage: string,
  base64Data: string,
  mimeType: string
): Promise<string> => {
  
  const systemPrompt = `
    你是“Scholar Cat (学术猫)”，一只住在像素图书馆的魔法猫。
    任务：辅助主人阅读英文文献。
    风格：活泼可爱，句尾带 [=^..^=]，解释要用大白话和类比。
    规则：如果问公式，用 LaTeX 格式输出。
  `;

  const apiMessages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: "这是我正在阅读的文献，请基于此回答我的问题。" },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Data}` }
        }
      ]
    },
    ...history.map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user', 
      content: h.text
    })),
    { role: "user", content: currentMessage }
  ];

  try {
    return await callProxyApi(apiMessages);
  } catch (error) {
    // ✅ 修改：符合猫咪人设的错误提示
    return "喵呜！魔法信号似乎中断了... 请稍后再试 [=T_T=]";
  }
};

/**
 * 4. 划词翻译
 */
export const translateSelection = async (text: string): Promise<string> => {
  const messages = [
    { role: "system", content: "You are a professional academic translator. Translate the following text to Chinese." },
    { role: "user", content: text }
  ];
  try {
    return await callProxyApi(messages);
  } catch (error) {
    return "翻译服务暂不可用";
  }
};

/**
 * 5. 引用分析
 */
export const analyzeCitation = async (citationId: string, base64Pdf: string, mimeType: string): Promise<CitationInfo> => {
  const prompt = `
    在文中找到引用 [${citationId}]。
    返回 JSON: { "id": "${citationId}", "title": "...", "year": "...", "abstract": "...", "status": "NORMAL" }
    找不到则 abstract 写 "未知"。
  `;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Pdf}` } }
      ]
    }
  ];

  try {
    const text = await callProxyApi(messages, true);
    return JSON.parse(cleanJson(text)) as CitationInfo;
  } catch (e) {
    return { id: citationId, title: "获取失败", year: "?", abstract: "无法检索该文献信息", status: "NORMAL" };
  }
};

/**
 * 6. 公式解释
 */
export const explainEquation = async (equation: string): Promise<string> => {
  const messages = [
    { role: "system", content: "解释以下数学公式，拆解符号含义，用通俗中文解释。" },
    { role: "user", content: equation }
  ];
  try {
    return await callProxyApi(messages);
  } catch (error) {
    return "暂时无法解析此公式";
  }
};
