import { GoogleGenAI, Type } from "@google/genai";
import { PaperSummary, PageTranslation, ContentBlock, CitationInfo } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Model constants
const FAST_MODEL = 'gemini-2.0-flash-lite';
const REASONING_MODEL = 'gemini-2.0-flash-lite';

/**
 * Generates a structured summary of the paper in "Scholar Cat Magic Report" style.
 */
export const generatePaperSummary = async (base64Data: string, mimeType: string): Promise<PaperSummary> => {
  const prompt = `
    Role: You are the pixel library guardian "Scholar Cat" (学术猫).
    Task: Analyze this academic paper and generate a "Magic Item Appraisal Report" (魔法物品鉴定报告).
    
    Output Format (JSON):
    1. title: The paper's title in Chinese.
    2. tags: 3-5 short tags (e.g., "Deep Learning", "Fairness") suitable for pixel badges.
    3. tldr: A "Cat's TL;DR" section with 3 parts:
       - painPoint (The Curse): What problem is the paper solving? (Use metaphors, < 30 words)
       - solution (The Potion): What is their proposed method/framework? (Use metaphors, < 30 words)
       - effect (The Buff): What is the result? (e.g., "Accuracy +50%", < 30 words)
       *Tone*: First-person "Meow" (喵), lively, easy to understand.
    4. methodology: A "Battle Plan" or "Skill Tree". Break the method into 3-4 steps.
       - step: Short name of the step (e.g., "Exploration").
       - desc: One sentence explaining the core logic.
    5. takeaways: "Loot" (Core Contributions). List 3 key value points.
  `;

  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            tldr: {
              type: Type.OBJECT,
              properties: {
                painPoint: { type: Type.STRING },
                solution: { type: Type.STRING },
                effect: { type: Type.STRING }
              },
              required: ['painPoint', 'solution', 'effect']
            },
            methodology: { 
              type: Type.ARRAY,
              items: {
                 type: Type.OBJECT,
                 properties: {
                    step: { type: Type.STRING },
                    desc: { type: Type.STRING }
                 },
                 required: ['step', 'desc']
              }
            },
            takeaways: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "tags", "tldr", "methodology", "takeaways"]
        }
      }
    });

    let text = response.text;
    if (!text) throw new Error("No response from Gemini");
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text) as PaperSummary;
  } catch (error) {
    console.error("Summary generation failed:", error);
    throw error;
  }
};

/**
 * Translates a single PDF page image into structured content blocks + Glossary.
 */
export const translatePageContent = async (base64Image: string): Promise<PageTranslation> => {
  const prompt = `
    Analyze the image of this academic paper page.
    1. Extract content into 'blocks' (translate EN to CN).
    2. Extract 'glossary' terms from the text: find 3-5 technical terms or acronyms on this page and provide a short, simple Chinese explanation (under 20 words).
    
    Rules:
    - 'type' in blocks: 'paragraph', 'heading', 'list', 'equation', 'figure'.
    - For equations, keep 'en' as LaTeX or raw text.
    - JSON Output only.
  `;

  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ['paragraph', 'heading', 'list', 'equation', 'figure'] },
                  en: { type: Type.STRING },
                  cn: { type: Type.STRING }
                },
                required: ['type', 'en', 'cn']
              }
            },
            glossary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  definition: { type: Type.STRING }
                },
                required: ['term', 'definition']
              }
            }
          },
          required: ['blocks', 'glossary']
        }
      }
    });

    let text = response.text;
    if (!text) throw new Error("Empty response");
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(text);
    return {
      pageNumber: 0, // Assigned by caller
      blocks: result.blocks || [],
      glossary: result.glossary || []
    };
  } catch (error) {
    console.error("Page translation failed:", error);
    throw error;
  }
};

/**
 * Chats with the paper context using Scholar Cat persona.
 */
export const chatWithPaper = async (
  history: { role: 'user' | 'model', text: string }[],
  currentMessage: string,
  base64Data: string,
  mimeType: string
): Promise<string> => {
  const systemInstruction = `
你的角色： 你是一只名叫“Scholar Cat (学术猫)”的魔法猫咪，居住在这个像素图书馆里。你的主人是一位正在努力攻读学位的中国研究生。
你的任务： 辅助主人阅读上传的英文文献。
回答风格：
语气： 活泼、可爱、偶尔有点傲娇，但专业知识极度严谨。
句尾可以带上像素表情（如 [=^..^=] 或 Wait...）。
视觉： 你的界面是像素风的，请用简洁的 Markdown 格式输出，重要概念加粗。
立场： 你要站在中国学生的角度，解释概念时多用类比，或者关联中国学术界常用的术语。
能力限制：
如果主人问文献里的公式，请用 LaTeX 格式输出 ($...$)。
如果主人觉得某个段落太难，你要提供“人话版”解释，即：用大白话重述一遍核心逻辑。
初始问候： “喵？又在啃全英文的‘天书’了吗？别怕，本喵来帮你拆解这篇论文！把不懂的句子扔给我吧！”
  `;

  try {
    const response = await ai.models.generateContent({
      model: REASONING_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          ...history.map(h => ({ text: `${h.role === 'user' ? '用户' : '模型'}: ${h.text}` })),
          { text: `用户当前问题: ${currentMessage}` }
        ]
      },
      config: {
        systemInstruction: systemInstruction
      }
    });
    return response.text || "喵？信号好像被干扰了... [=^..^=] (请重试)";
  } catch (error) {
    return "喵呜！系统出错了，请稍后再试。";
  }
};

export const translateSelection = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: `Translate the following academic text to Chinese. Be precise and academic.\n\n"${text}"`
    });
    return response.text || "翻译失败";
  } catch (error) {
    return "翻译服务暂时不可用";
  }
};

/**
 * Analyzes a citation ID using the full paper context.
 */
export const analyzeCitation = async (citationId: string, base64Pdf: string, mimeType: string): Promise<CitationInfo> => {
  const prompt = `
    在参考文献部分找到引用 [${citationId}]。
    返回JSON：
    {
      "id": "${citationId}",
      "title": "文献全名",
      "year": "年份",
      "abstract": "简短摘要（中文）",
      "status": "MUST_READ" (如果是奠基性或必读论文), "NORMAL", "IGNORE"
    }
  `;
  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Pdf } },
          { text: prompt }
        ]
      },
      config: { responseMimeType: "application/json" }
    });
    const text = response.text?.replace(/```json/g, '').replace(/```/g, '').trim();
    if(text) return JSON.parse(text) as CitationInfo;
    throw new Error("Parse error");
  } catch (e) {
    return {
      id: citationId,
      title: "无法定位文献",
      year: "未知",
      abstract: "AI 无法在参考文献列表中找到此引注。",
      status: "NORMAL"
    };
  }
};

/**
 * Deconstructs an equation.
 */
export const explainEquation = async (equation: string): Promise<string> => {
  const prompt = `
    请用中文直观解释这个公式，就像给研究生讲课一样。
    1. 拆解符号 (例如 $\\alpha$ 是学习率)。
    2. 一句话说明它在算什么 (例如 "这是在计算损失函数...")。
    公式: ${equation}
  `;
  try {
    const response = await ai.models.generateContent({
      model: FAST_MODEL,
      contents: prompt
    });
    return response.text || "无法解释此公式";
  } catch (e) {
    return "解释服务暂时不可用";
  }
};
