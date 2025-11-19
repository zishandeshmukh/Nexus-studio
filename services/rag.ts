
import { generateEmbedding } from './gemini';

export interface CodeChunk {
    id: string;
    fileName: string;
    content: string;
    embedding?: number[];
}

export const chunkCode = (fullCodeContext: string): CodeChunk[] => {
    // Assuming format: --- FILE: path --- \n content \n --- END OF FILE ---
    const regex = /--- FILE: (.*?) ---\n([\s\S]*?)\n--- END OF FILE ---/g;
    const chunks: CodeChunk[] = [];
    let match;
    let idx = 0;

    while ((match = regex.exec(fullCodeContext)) !== null) {
        const fileName = match[1];
        const content = match[2];
        
        // If content is massive, we might want to sub-chunk it (e.g. by 200 lines)
        // For now, we treat each file as a document, or split if > 1500 chars
        
        if (content.length > 2000) {
            const subChunks = content.match(/[\s\S]{1,2000}/g) || [];
            subChunks.forEach((sc, i) => {
                chunks.push({
                    id: `chunk-${idx++}`,
                    fileName: `${fileName} (Part ${i+1})`,
                    content: sc
                });
            });
        } else {
            chunks.push({
                id: `chunk-${idx++}`,
                fileName,
                content
            });
        }
    }
    return chunks;
};

export const indexCodebase = async (
    codeContext: string, 
    onProgress: (curr: number, total: number) => void
): Promise<CodeChunk[]> => {
    const chunks = chunkCode(codeContext);
    const indexedChunks: CodeChunk[] = [];
    
    // Batch processing to avoid rate limits? Client-side loop.
    // Depending on API limits, we might need to slow down.
    for (let i = 0; i < chunks.length; i++) {
        onProgress(i + 1, chunks.length);
        try {
            const embedding = await generateEmbedding(chunks[i].content);
            indexedChunks.push({ ...chunks[i], embedding });
        } catch (e) {
            console.warn(`Failed to embed chunk ${chunks[i].fileName}`, e);
            indexedChunks.push({ ...chunks[i] }); // Push without embedding
        }
        // Small delay to be nice to API
        await new Promise(r => setTimeout(r, 50));
    }
    
    return indexedChunks;
};

const cosineSimilarity = (vecA: number[], vecB: number[]) => {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        magnitudeA += vecA[i] * vecA[i];
        magnitudeB += vecB[i] * vecB[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    return dotProduct / (magnitudeA * magnitudeB);
};

export const searchCodebase = async (
    query: string, 
    indexedChunks: CodeChunk[], 
    topK: number = 3
): Promise<CodeChunk[]> => {
    if (!indexedChunks.some(c => c.embedding)) return [];
    
    try {
        const queryEmbedding = await generateEmbedding(query);
        
        const scored = indexedChunks
            .filter(c => c.embedding)
            .map(chunk => ({
                ...chunk,
                score: cosineSimilarity(queryEmbedding, chunk.embedding!)
            }));
            
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    } catch (e) {
        console.error("Search failed", e);
        return [];
    }
};
