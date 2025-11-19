
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { MODELS, SYSTEM_INSTRUCTIONS } from "../constants";
import { VoiceName } from "../types";

// Dynamic Key Management
let dynamicApiKey = localStorage.getItem('nexus_api_key') || process.env.API_KEY || '';

export const setGlobalApiKey = (key: string) => {
  dynamicApiKey = key;
  localStorage.setItem('nexus_api_key', key);
};

export const hasValidKey = () => {
  return !!dynamicApiKey;
};

const getAIClient = () => {
  if (!dynamicApiKey) {
    throw new Error("API Key is missing. Please set your Google Gemini API Key in settings.");
  }
  return new GoogleGenAI({ apiKey: dynamicApiKey });
};

// Chat Generation (Stream)
export const streamChatResponse = async function* (
  history: { role: string; parts: { text: string }[] }[],
  newMessage: string
) {
  const ai = getAIClient();
  const chat = ai.chats.create({
    model: MODELS.CHAT,
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS.CHAT,
    },
    history: history,
  });

  const result = await chat.sendMessageStream({ message: newMessage });

  for await (const chunk of result) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      yield c.text;
    }
  }
};

export interface CustomModule {
  id: string;
  name: string;
  instruction: string;
}

export interface RepoAnalysisConfig {
  temperature: number;
  modules: string[];
  customModules?: CustomModule[];
}

// Repository Analysis (Stream)
export const analyzeRepositoryStream = async function* (
  codeContent: string,
  config: RepoAnalysisConfig = { temperature: 0.2, modules: [], customModules: [] }
) {
  const ai = getAIClient();
  
  // Dynamic System Instruction Builder
  let systemInstruction = SYSTEM_INSTRUCTIONS.REPO;
  
  const activeStandardModules = config.modules.filter(m => !config.customModules?.find(cm => cm.id === m));
  const activeCustomModules = config.customModules?.filter(cm => config.modules.includes(cm.id)) || [];

  if (config.modules && config.modules.length > 0) {
    const moduleNames = [
        ...activeStandardModules, 
        ...activeCustomModules.map(m => m.name)
    ];

    const baseInstruction = `You are a World-Class Principal Software Architect. Analyze the provided code repository.
    
    Focus SPECIFICALLY on the following aspects based on user configuration:
    ${moduleNames.join(', ')}.
    
    If a section is NOT listed above, you may briefly summarize it or omit it to focus depth on the requested areas.
    `;

    // Map modules to specific requirements
    let details = "\n\nDETAILED REQUIREMENTS:\n";
    if (activeStandardModules.includes('Architecture Review')) {
      details += "- Architecture: Analyze patterns, modularity, and project structure.\n";
    }
    if (activeStandardModules.includes('Security Audit')) {
      details += "- Security: CRITICAL. Look for OWASP Top 10, secret leaks, injection flaws.\n";
    }
    if (activeStandardModules.includes('Code Quality')) {
      details += "- Code Quality: Identify code smells, cyclomatic complexity, and maintainability issues.\n";
    }
    if (activeStandardModules.includes('Code Duplication Detection')) {
      details += "- Code Duplication Detection: CRITICAL. Identify copied code blocks, similar functions across files, and opportunities for DRY (Don't Repeat Yourself). Report the specific files and lines where duplication occurs.\n";
    }
    if (activeStandardModules.includes('Performance Profile')) {
      details += "- Performance: Identify complexity (Big O), bottlenecks, and resource usage.\n";
    }
    if (activeStandardModules.includes('Refactoring Recommendations')) {
      details += "- Refactoring: Provide concrete code snippets for improvement.\n";
    }

    // Add Custom Module Instructions
    if (activeCustomModules.length > 0) {
        details += "\nCUSTOM ANALYSIS MODULES:\n";
        activeCustomModules.forEach(cm => {
            details += `- ${cm.name}: ${cm.instruction}\n`;
        });
    }

    details += `\n\nALWAYS END WITH:
    **CRITICAL REQUIREMENT:**
    Generate a professional **README.md** file content for this repository inside a Markdown code block labeled 'markdown'.`;

    systemInstruction = baseInstruction + details;
  }

  const responseStream = await ai.models.generateContentStream({
    model: MODELS.REPO,
    contents: codeContent,
    config: {
      systemInstruction: systemInstruction,
      temperature: config.temperature,
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
};

// Single File Deep Dive (Stream)
export const analyzeFileDeepDiveStream = async function* (fileContent: string, fileName: string) {
  const ai = getAIClient();
  
  const prompt = `FILE NAME: ${fileName}\n\nCONTENT:\n${fileContent}`;

  const responseStream = await ai.models.generateContentStream({
    model: MODELS.REPO,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS.FILE_DEEP_DIVE,
      temperature: 0.2, 
    }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
};

// Code Agent (Stream) - Supports Multimodal and History
export const streamCodeAgent = async function* (
    currentCode: string, 
    history: { role: string; text: string; images?: string[] }[], 
    newMessage: string, 
    newImages?: string[],
    options?: { isFastMode?: boolean; selectedCode?: string }
) {
  const ai = getAIClient();
  
  // Construct the chat history for the model
  const geminiHistory = history.map(msg => {
    const parts: any[] = [{ text: msg.text }];
    if (msg.images) {
        msg.images.forEach(img => {
            // Assume base64 string
            const cleanBase64 = img.split(',')[1] || img;
            parts.push({ inlineData: { mimeType: 'image/png', data: cleanBase64 } });
        });
    }
    return {
        role: msg.role,
        parts: parts
    };
  });

  // Add Current Code Context to System Instruction dynamically
  let dynamicSystemInstruction = `${SYSTEM_INSTRUCTIONS.AGENT}\n\nCURRENT CODE CONTEXT:\n${currentCode.substring(0, 150000)}`; // Limit context

  // If selection exists, append it to highlight focus
  if (options?.selectedCode) {
      dynamicSystemInstruction += `\n\nUSER SELECTED CODE TO MODIFY:\n${options.selectedCode}\n\n(Focus your changes primarily on this selection)`;
  }

  const chat = ai.chats.create({
    // Switch model based on fast mode
    model: options?.isFastMode ? MODELS.REPO_FAST : MODELS.REPO, 
    config: {
      systemInstruction: dynamicSystemInstruction,
      temperature: options?.isFastMode ? 0.4 : 0.2, // Higher temp for fast creative mode
    },
    history: geminiHistory
  });

  // Construct new message content
  const messageParts: any[] = [{ text: newMessage }];
  if (newImages && newImages.length > 0) {
      newImages.forEach(img => {
         const cleanBase64 = img.split(',')[1] || img;
         messageParts.push({ inlineData: { mimeType: 'image/png', data: cleanBase64 } });
      });
  }

  const result = await chat.sendMessageStream({ 
      message: messageParts 
  });

  for await (const chunk of result) {
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      yield c.text;
    }
  }
};

// Diagrams Generator (Stream)
export const streamDiagramGenerator = async function* (codeContext: string, type: 'class' | 'flow' | 'state') {
  const ai = getAIClient();
  const prompt = `Analyze the following code and generate a Mermaid.js diagram definition.
  
  TYPE: ${type === 'class' ? 'Class Diagram' : type === 'flow' ? 'Flowchart' : 'State Diagram'}
  
  RULES:
  1. Output ONLY the Mermaid.js syntax code.
  2. START your response with \`\`\`mermaid and END with \`\`\`.
  3. Do NOT include any conversational text like "Here is the diagram".
  4. Keep node labels concise.
  
  CODE CONTEXT:
  ${codeContext.substring(0, 50000)} // Limit context for safety
  `;

  const responseStream = await ai.models.generateContentStream({
    model: MODELS.REPO,
    contents: prompt,
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

// Roadmap Generator (Stream)
export const streamRoadmapGenerator = async function* (analysisReport: string) {
  const ai = getAIClient();
  const prompt = `Based on the following Repository Analysis, create a project roadmap/task list.
  
  ANALYSIS REPORT:
  ${analysisReport}
  
  OUTPUT FORMAT:
  Return a JSON array of objects (but streamed as text). Each object must have:
  - id: string
  - title: string (short action item)
  - category: 'Refactoring' | 'Security' | 'Performance' | 'Feature'
  - priority: 'High' | 'Medium' | 'Low'
  - status: 'todo'
  
  Example format:
  [
    {"id": "1", "title": "Fix SQL Injection in login.ts", "category": "Security", "priority": "High", "status": "todo"},
    ...
  ]
  
  Output ONLY the raw JSON string. No markdown.
  `;

  const responseStream = await ai.models.generateContentStream({
    model: MODELS.REPO_FAST,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  });

  for await (const chunk of responseStream) {
    if (chunk.text) {
      yield chunk.text;
    }
  }
}

// Embeddings Generator
export const generateEmbedding = async (text: string): Promise<number[]> => {
    const ai = getAIClient();
    const result = await ai.models.embedContent({
        model: MODELS.EMBEDDING,
        contents: text
    });
    if (result.embeddings && result.embeddings.length > 0 && result.embeddings[0].values) {
        return result.embeddings[0].values;
    }
    throw new Error("Failed to generate embedding");
};

// Vision Analysis
export const analyzeImage = async (base64Image: string, prompt: string): Promise<string> => {
  const ai = getAIClient();
  
  // Remove header if present (e.g., "data:image/png;base64,")
  const cleanBase64 = base64Image.split(',')[1] || base64Image;
  
  // Determine mimeType roughly from header or default to png/jpeg. 
  let mimeType = 'image/png';
  if (base64Image.includes('image/jpeg')) mimeType = 'image/jpeg';
  if (base64Image.includes('image/webp')) mimeType = 'image/webp';

  const response = await ai.models.generateContent({
    model: MODELS.VISION,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: cleanBase64
          }
        },
        { text: prompt || "Describe this image." }
      ]
    }
  });

  return response.text || "No analysis returned.";
};

// Text to Speech
export const generateSpeech = async (text: string, voice: VoiceName): Promise<ArrayBuffer> => {
  const ai = getAIClient();
  
  // Clean text just in case (remove large code blocks which break TTS)
  const cleanText = text.replace(/```[\s\S]*?```/g, " Code block omitted. ").substring(0, 4000);

  const response = await ai.models.generateContent({
    model: MODELS.TTS,
    contents: [{ parts: [{ text: cleanText }] }], 
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    const textError = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (textError) {
        throw new Error(`TTS refused: ${textError}`);
    }
    throw new Error("No audio data generated");
  }

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes.buffer;
};
