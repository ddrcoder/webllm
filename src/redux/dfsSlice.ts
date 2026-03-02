import {createSlice} from '@reduxjs/toolkit'

export type NodeStatus = 'pending' | 'exploring' | 'exhausted' | 'pangram' | 'pruned';

export type DFSNode = {
    id: string;
    parentId: string | null;
    word: string;
    depth: number;
    coveredLetters: string; // sorted unique letters so far, e.g. "abcdefg"
    coverageCount: number;
    status: NodeStatus;
    childIds: string[];
    sentence: string;
    newLetters: string; // letters this word contributed
}

type DFSState = {
    nodes: Record<string, DFSNode>;
    rootId: string | null;
    currentNodeId: string | null;
    bestPangram: string | null;
    bestPangramLength: number;
    pangrams: string[];
    isRunning: boolean;
    isPaused: boolean;
    status: string;
    nodesExplored: number;
    modelStatus: string;
    modelReady: boolean;
    criticalError: string | false;
}

const initialState: DFSState = {
    nodes: {},
    rootId: null,
    currentNodeId: null,
    bestPangram: null,
    bestPangramLength: Infinity,
    pangrams: [],
    isRunning: false,
    isPaused: false,
    status: 'idle',
    nodesExplored: 0,
    modelStatus: 'waiting',
    modelReady: false,
    criticalError: false,
}

export const dfsSlice = createSlice({
    name: 'dfs',
    initialState,
    reducers: {
        addNode: (state, {payload}: { payload: DFSNode }) => {
            state.nodes[payload.id] = payload;
            if (payload.parentId && state.nodes[payload.parentId]) {
                state.nodes[payload.parentId].childIds.push(payload.id);
            }
        },
        updateNodeStatus: (state, {payload}: { payload: { id: string; status: NodeStatus } }) => {
            if (state.nodes[payload.id]) {
                state.nodes[payload.id].status = payload.status;
            }
        },
        setCurrentNode: (state, {payload}: { payload: string | null }) => {
            state.currentNodeId = payload;
        },
        setRootId: (state, {payload}: { payload: string }) => {
            state.rootId = payload;
        },
        foundPangram: (state, {payload}: { payload: string }) => {
            state.pangrams.push(payload);
            if (payload.length < state.bestPangramLength) {
                state.bestPangram = payload;
                state.bestPangramLength = payload.length;
            }
        },
        setIsRunning: (state, {payload}: { payload: boolean }) => {
            state.isRunning = payload;
        },
        setIsPaused: (state, {payload}: { payload: boolean }) => {
            state.isPaused = payload;
        },
        setStatus: (state, {payload}: { payload: string }) => {
            state.status = payload;
        },
        incrementNodesExplored: (state) => {
            state.nodesExplored++;
        },
        setModelStatus: (state, {payload}: { payload: string }) => {
            state.modelStatus = payload;
        },
        setModelReady: (state, {payload}: { payload: boolean }) => {
            state.modelReady = payload;
        },
        setCriticalError: (state, {payload}: { payload: string }) => {
            state.criticalError = payload;
        },
        resetSearch: (state) => {
            state.nodes = {};
            state.rootId = null;
            state.currentNodeId = null;
            state.bestPangram = null;
            state.bestPangramLength = Infinity;
            state.pangrams = [];
            state.isRunning = false;
            state.isPaused = false;
            state.status = 'idle';
            state.nodesExplored = 0;
        },
    },
})

export const {
    addNode, updateNodeStatus, setCurrentNode, setRootId,
    foundPangram, setIsRunning, setIsPaused, setStatus,
    incrementNodesExplored, setModelStatus, setModelReady,
    setCriticalError, resetSearch,
} = dfsSlice.actions;
export const dfsReducer = dfsSlice.reducer;
