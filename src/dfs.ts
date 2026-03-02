import {generateWords} from "./LLM.ts";
import {dispatch, getState} from "./redux/store.ts";
import {
    addNode, updateNodeStatus, setCurrentNode, setRootId,
    foundPangram, setIsRunning, setStatus,
    incrementNodesExplored, type DFSNode,
} from "./redux/dfsSlice.ts";

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const ALL_LETTERS = new Set(ALPHABET.split(''));
const MAX_DEPTH = 12;
const CANDIDATES_PER_NODE = 3;

let nodeCounter = 0;
let abortFlag = false;
let pauseResolve: (() => void) | null = null;

function getLetters(text: string): Set<string> {
    const s = new Set<string>();
    for (const ch of text.toLowerCase()) {
        if (ch >= 'a' && ch <= 'z') s.add(ch);
    }
    return s;
}

function union(a: Set<string>, b: Set<string>): Set<string> {
    const result = new Set(a);
    for (const x of b) result.add(x);
    return result;
}

function difference(a: Set<string>, b: Set<string>): string[] {
    const result: string[] = [];
    for (const x of a) {
        if (!b.has(x)) result.push(x);
    }
    return result.sort();
}

function setToSorted(s: Set<string>): string {
    return [...s].sort().join('');
}

function makeNodeId(): string {
    return `node_${nodeCounter++}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitIfPaused(): Promise<void> {
    const isPaused = getState(s => s.dfs.isPaused);
    if (isPaused) {
        await new Promise<void>(resolve => {
            pauseResolve = resolve;
        });
    }
}

export function resumeSearch() {
    if (pauseResolve) {
        pauseResolve();
        pauseResolve = null;
    }
}

export function stopSearch() {
    abortFlag = true;
    resumeSearch(); // unblock if paused
}

export async function startSearch() {
    abortFlag = false;
    nodeCounter = 0;

    const rootId = makeNodeId();
    const rootNode: DFSNode = {
        id: rootId,
        parentId: null,
        word: '(root)',
        depth: 0,
        coveredLetters: '',
        coverageCount: 0,
        status: 'exploring',
        childIds: [],
        sentence: '',
        newLetters: '',
    };

    dispatch(addNode(rootNode));
    dispatch(setRootId(rootId));
    dispatch(setCurrentNode(rootId));
    dispatch(setIsRunning(true));
    dispatch(setStatus('Starting DFS search...'));

    try {
        await dfs(rootId);
    } catch (e: any) {
        console.error('DFS error:', e);
        dispatch(setStatus('Error: ' + (e.message || String(e))));
    }

    dispatch(setIsRunning(false));
    const best = getState(s => s.dfs.bestPangram);
    if (best) {
        dispatch(setStatus(`Search complete! Best pangram: "${best}"`));
    } else {
        dispatch(setStatus(abortFlag ? 'Search stopped.' : 'Search complete. No pangram found.'));
    }
}

async function dfs(nodeId: string): Promise<void> {
    if (abortFlag) return;
    await waitIfPaused();

    const node = getState(s => s.dfs.nodes[nodeId]);
    if (!node) return;

    dispatch(setCurrentNode(nodeId));
    dispatch(incrementNodesExplored());

    const covered = new Set(node.coveredLetters.split('').filter(c => c));
    const missing = difference(ALL_LETTERS, covered);

    // Check if pangram
    if (missing.length === 0) {
        dispatch(updateNodeStatus({id: nodeId, status: 'pangram'}));
        dispatch(foundPangram(node.sentence));
        dispatch(setStatus(`Found pangram: "${node.sentence}"`));
        return;
    }

    // Prune: too deep
    if (node.depth >= MAX_DEPTH) {
        dispatch(updateNodeStatus({id: nodeId, status: 'pruned'}));
        return;
    }

    // Prune: current sentence already longer than best pangram
    const bestLen = getState(s => s.dfs.bestPangramLength);
    if (node.sentence.length >= bestLen) {
        dispatch(updateNodeStatus({id: nodeId, status: 'pruned'}));
        return;
    }

    // Generate candidate words via LLM
    dispatch(setStatus(`Depth ${node.depth}: asking LLM for words (${missing.length} letters missing)...`));

    let candidates: string[];
    try {
        candidates = await generateWords(node.sentence, missing, CANDIDATES_PER_NODE);
    } catch (e: any) {
        console.error('LLM error:', e);
        dispatch(updateNodeStatus({id: nodeId, status: 'exhausted'}));
        dispatch(setStatus('LLM error: ' + (e.message || String(e))));
        return;
    }

    if (candidates.length === 0) {
        dispatch(updateNodeStatus({id: nodeId, status: 'exhausted'}));
        return;
    }

    // Sort candidates: prefer words that cover more missing letters
    candidates.sort((a, b) => {
        const aNew = difference(getLetters(a), covered).length;
        const bNew = difference(getLetters(b), covered).length;
        return bNew - aNew; // more new letters first (DFS explores first child first)
    });

    // Create child nodes
    const childIds: string[] = [];
    for (const word of candidates) {
        const wordLetters = getLetters(word);
        const newCovered = union(covered, wordLetters);
        const newLettersSet = new Set(difference(wordLetters, covered));
        const childId = makeNodeId();
        const childNode: DFSNode = {
            id: childId,
            parentId: nodeId,
            word,
            depth: node.depth + 1,
            coveredLetters: setToSorted(newCovered),
            coverageCount: newCovered.size,
            status: 'pending',
            childIds: [],
            sentence: node.sentence ? `${node.sentence} ${word}` : word,
            newLetters: [...newLettersSet].sort().join(''),
        };
        dispatch(addNode(childNode));
        childIds.push(childId);
    }

    // Small delay so UI can render
    await sleep(50);

    // DFS into children
    for (const childId of childIds) {
        if (abortFlag) break;
        dispatch(updateNodeStatus({id: childId, status: 'exploring'}));
        await dfs(childId);
    }

    dispatch(updateNodeStatus({id: nodeId, status: 'exhausted'}));
}
