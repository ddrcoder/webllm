import type {MLCEngine} from "@mlc-ai/web-llm";
import {
    setModelStatus, setModelReady, setCriticalError
} from "./redux/dfsSlice.ts";
import {dispatch} from "./redux/store.ts";

let libraryCache: any = null;

async function getLibrary() {
    if (libraryCache) {
        return libraryCache;
    }
    const {CreateMLCEngine} = await import("@mlc-ai/web-llm");
    libraryCache = {CreateMLCEngine};
    return libraryCache;
}

let engine: MLCEngine | null = null;

export function getEngine(): MLCEngine | null {
    return engine;
}

export async function downloadModel(name: string) {
    try {
        dispatch(setModelStatus('Loading LLM library...'));
        const {CreateMLCEngine} = await getLibrary();
        dispatch(setModelStatus('Loading model ' + name + '...'));
        engine = await CreateMLCEngine(
            name,
            {
                initProgressCallback: (p: any) => {
                    if (p?.text) {
                        dispatch(setModelStatus(p.text));
                    }
                }
            }
        );
    } catch (error: any) {
        const msg = error.message || JSON.stringify(error);
        dispatch(setCriticalError(msg));
        dispatch(setModelStatus('Error loading model'));
        console.error(error);
        return;
    }
    dispatch(setModelStatus('Model ready'));
    dispatch(setModelReady(true));
    localStorage.setItem('downloaded_models', JSON.stringify([name]));
}

export async function generateWords(
    sentence: string,
    missingLetters: string[],
    count: number = 3
): Promise<string[]> {
    if (!engine) throw new Error("Model not loaded");

    const missing = missingLetters.join(', ');
    const prompt = sentence
        ? `I'm writing a pangram (a sentence using every letter A-Z at least once). So far: "${sentence}". Letters still needed: ${missing}. Suggest ${count} different single common English words that could naturally continue this sentence while using as many of the missing letters as possible. Reply with ONLY the ${count} words, one per line, no numbering or extra text.`
        : `I'm writing a pangram (a sentence using every letter A-Z at least once). Letters still needed: ${missing}. Suggest ${count} different single common English words to START a sentence, choosing words that use as many of the missing letters as possible. Reply with ONLY the ${count} words, one per line, no numbering or extra text.`;

    const response = await engine.chat.completions.create({
        messages: [{role: 'user', content: prompt}],
        max_tokens: 50,
        temperature: 0.9,
        top_p: 0.95,
    });

    const text = response.choices?.[0]?.message?.content ?? "";
    const words = text
        .split('\n')
        .map(w => w.trim().replace(/^[\d.)\-*]+\s*/, '').replace(/[^a-zA-Z]/g, '').toLowerCase())
        .filter(w => w.length > 0 && w.length <= 15);

    // Deduplicate
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const w of words) {
        if (!seen.has(w)) {
            seen.add(w);
            unique.push(w);
        }
    }

    return unique.slice(0, count);
}
