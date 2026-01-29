import { PaperSummary, PageTranslation, ContentBlock, CitationInfo } from "../types";

// ================= 配置区域 =================
const API_KEY = import.meta.env.VITE_PROXY_API_KEY;
const BASE_URL = import.meta.env.VITE_PROXY_BASE_URL; // 必须以 /v1 结尾，例如 https://api.xyz.com/v1
const MODEL_NAME = '[贩子死妈]gemini-3-flash-preview'; // 即使是反代，通常也支持这个模型名

// 检查配置
if (!API_KEY || !BASE_URL) {
  console.error("❌ 反代配置缺失！请在 .env 中设置 VITE_PROXY_API_KEY 和 VITE_PROXY_BASE_URL");
}

// ================= 工具函数 =================

/**
 * 通用 Fetch 请求封装 (OpenAI 兼容格式)
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

  // 如果需要强制 JSON 输出 (部分反代支持 response_format)
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
      throw new Error(`API Error ${response.status}: ${errData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error("Proxy Request Failed:", error);
    throw error;
  }
}

/**
 * 清洗 JSON 字符串 (去除 Markdown 代码块)
 */
function cleanJson(text: string): string {
  if (!text) return "{}";
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ================= 核心业务函数 =================

/**
 * 1. 生成论文摘要 (Scholar Cat 风格)
 */
export const generatePaperSummary = async (base64Data: string, mimeType: string): Promise<PaperSummary> => {
  const prompt = `
    Role: You are the pixel library guardian "Scholar Cat" (学术猫).
    Task: Analyze this academic paper and generate a "Magic Item Appraisal Report".
    
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
  `;

  // 构造带附件的消息 (适配 OpenAI Vision 格式)
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            // 反代通常只认 image/jpeg 等图片格式，如果是 PDF，部分反代可能不支持直接传 Base64
            // 这里假设你的反代支持 GPT-4o 风格的多模态输入
            url: `data:${mimeType};base64,${base64Data}`
          }
        }
      ]
    }
  ];

  try {
    const text = await callProxyApi(messages, true);
    return JSON.parse(cleanJson(text)) as PaperSummary;
  } catch (error) {
    console.error("Summary generation failed:", error);
    // 返回兜底数据防止白屏
    return {
      title: "读取失败",
      tags: ["Error"],
      tldr: { painPoint: "连接反代失败", solution: "请检查 Key", effect: "无" },
      methodology: [],
      takeaways: []
    };
  }
};

/**
 * 2. 翻译页面 (图文识别)
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
    return {
      pageNumber: 0,
      blocks: [{ type: "paragraph", en: "Error", cn: "页面翻译失败，请检查反代是否支持识图。" }],
      glossary: []
    };
  }
};

/**
 * 3. 聊天功能 (多轮对话)
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

  // 构造历史消息
  // 注意：反代模式是无状态的，我们需要每次把 PDF 上下文发过去
  // 为了节省 Token，我们只在第一条消息带 PDF，或者依靠上下文窗口
  const apiMessages = [
    { role: "system", content: systemPrompt },
    // 模拟将 PDF 作为第一条用户消息的内容
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
    // 插入历史记录
    ...history.map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user', // OpenAI 格式用 assistant
      content: h.text
    })),
    // 当前问题
    { role: "user", content: currentMessage }
  ];

  try {
    return await callProxyApi(apiMessages);
  } catch (error) {
    return "喵呜！反代服务器连接断开了... [=T_T=]";
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
    return "翻译失败";
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
    return { id: citationId, title: "未知", year: "?", abstract: "检索失败", status: "NORMAL" };
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
    return "无法解释公式";
  }
};
