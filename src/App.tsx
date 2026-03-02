import {useEffect, useState, useCallback, memo} from "react";
import {useTypedSelector} from "./redux/store.ts";
import {
    Box,
    Button,
    CssBaseline,
    Paper,
    ThemeProvider,
    Typography,
    createTheme,
    LinearProgress,
} from "@mui/material";
import {downloadModel} from "./LLM.ts";
import {startSearch, stopSearch, resumeSearch} from "./dfs.ts";
import {isWebGPUok} from "./CheckWebGPU.ts";
import {dispatch} from "./redux/store.ts";
import {
    setCriticalError, setIsPaused, resetSearch,
    type NodeStatus,
} from "./redux/dfsSlice.ts";

const MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
const MODEL_SIZE_MB = 664;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// --- Theme ---
const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        background: {default: '#1a1a2e', paper: '#16213e'},
        primary: {main: '#0f3460'},
        secondary: {main: '#e94560'},
    },
    typography: {
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    },
});

// --- Status colors ---
const STATUS_COLORS: Record<NodeStatus, string> = {
    pending: '#555',
    exploring: '#f0c040',
    exhausted: '#666',
    pangram: '#4caf50',
    pruned: '#8b4513',
};

// --- Tree Node Component ---
const TreeNode = memo(function TreeNode({nodeId, isCurrentPath}: {nodeId: string; isCurrentPath: boolean}) {
    const node = useTypedSelector(s => s.dfs.nodes[nodeId]);
    const currentNodeId = useTypedSelector(s => s.dfs.currentNodeId);
    const [collapsed, setCollapsed] = useState(false);

    if (!node) return null;
    const isCurrent = nodeId === currentNodeId;
    const isRoot = node.parentId === null;

    return (
        <Box sx={{ml: isRoot ? 0 : 2.5, position: 'relative'}}>
            {/* Vertical connector line from parent */}
            {!isRoot && (
                <Box sx={{
                    position: 'absolute', left: -12, top: 0, bottom: 0,
                    width: '1px', bgcolor: isCurrentPath ? '#f0c040' : '#333',
                }} />
            )}
            {/* Horizontal connector */}
            {!isRoot && (
                <Box sx={{
                    position: 'absolute', left: -12, top: 14, width: 12,
                    height: '1px', bgcolor: isCurrentPath ? '#f0c040' : '#333',
                }} />
            )}

            {/* Node content */}
            <Box
                onClick={() => node.childIds.length > 0 && setCollapsed(!collapsed)}
                sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    py: 0.3, px: 0.8, my: 0.2, borderRadius: 1,
                    cursor: node.childIds.length > 0 ? 'pointer' : 'default',
                    bgcolor: isCurrent ? 'rgba(240,192,64,0.15)' : 'transparent',
                    border: isCurrent ? '1px solid #f0c040' : '1px solid transparent',
                    transition: 'all 0.2s',
                    '&:hover': {bgcolor: 'rgba(255,255,255,0.05)'},
                }}
            >
                {/* Status dot */}
                <Box sx={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    bgcolor: STATUS_COLORS[node.status],
                    boxShadow: isCurrent ? '0 0 6px #f0c040' : 'none',
                }} />

                {/* Word */}
                <Typography
                    variant="body2"
                    sx={{
                        fontWeight: isCurrent ? 700 : 400,
                        color: node.status === 'pangram' ? '#4caf50'
                            : node.status === 'pruned' ? '#666'
                            : isCurrentPath ? '#f0c040'
                            : '#ccc',
                        fontSize: '0.8rem',
                    }}
                >
                    {isRoot ? '(start)' : node.word}
                </Typography>

                {/* Coverage badge */}
                {!isRoot && (
                    <Typography
                        variant="caption"
                        sx={{
                            bgcolor: `hsl(${(node.coverageCount / 26) * 120}, 70%, 25%)`,
                            color: '#fff', px: 0.5, borderRadius: 0.5,
                            fontSize: '0.65rem', lineHeight: 1.4,
                        }}
                    >
                        {node.coverageCount}/26
                    </Typography>
                )}

                {/* New letters badge */}
                {node.newLetters && (
                    <Typography
                        variant="caption"
                        sx={{color: '#4caf50', fontSize: '0.65rem'}}
                    >
                        +{node.newLetters}
                    </Typography>
                )}

                {/* Collapse indicator */}
                {node.childIds.length > 0 && (
                    <Typography variant="caption" sx={{color: '#555', fontSize: '0.6rem', ml: 0.3}}>
                        {collapsed ? `▸ ${node.childIds.length}` : '▾'}
                    </Typography>
                )}
            </Box>

            {/* Children */}
            {!collapsed && node.childIds.map(childId => (
                <TreeNode
                    key={childId}
                    nodeId={childId}
                    isCurrentPath={isCurrentPath && isOnCurrentPath(childId)}
                />
            ))}
        </Box>
    );
});

function isOnCurrentPath(_nodeId: string): boolean {
    // Simple heuristic: we highlight exploring nodes
    return true; // The highlighting is handled via status
}

// --- Alphabet Display ---
function AlphabetDisplay({coveredLetters}: {coveredLetters: string}) {
    const covered = new Set(coveredLetters.split(''));
    return (
        <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 0.3}}>
            {ALPHABET.split('').map(letter => (
                <Box
                    key={letter}
                    sx={{
                        width: 26, height: 26,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 0.5,
                        bgcolor: covered.has(letter) ? '#4caf50' : '#2a2a3e',
                        color: covered.has(letter) ? '#fff' : '#555',
                        fontSize: '0.75rem', fontWeight: 700,
                        transition: 'all 0.3s',
                        textTransform: 'uppercase',
                    }}
                >
                    {letter}
                </Box>
            ))}
        </Box>
    );
}

// --- Main App ---
export function App() {
    const {
        nodes, rootId, currentNodeId, bestPangram, pangrams,
        isRunning, isPaused, status, nodesExplored,
        modelStatus, modelReady, criticalError,
    } = useTypedSelector(s => s.dfs);

    const [autoLoaded, setAutoLoaded] = useState(false);

    const currentNode = currentNodeId ? nodes[currentNodeId] : null;
    const currentCovered = currentNode?.coveredLetters ?? '';
    const coverageCount = currentCovered.length;

    useEffect(() => {
        isWebGPUok().then(result => {
            if (result !== true) {
                dispatch(setCriticalError('WebGPU error: ' + result));
            }
        });
        if (!('caches' in window)) {
            dispatch(setCriticalError('Cache API is not supported'));
        }
        if (localStorage.getItem('downloaded_models')) {
            setAutoLoaded(true);
            downloadModel(MODEL);
        }
    }, []);

    const handleStart = useCallback(() => {
        dispatch(resetSearch());
        startSearch();
    }, []);

    const handleStop = useCallback(() => {
        stopSearch();
    }, []);

    const handlePauseResume = useCallback(() => {
        if (isPaused) {
            dispatch(setIsPaused(false));
            resumeSearch();
        } else {
            dispatch(setIsPaused(true));
        }
    }, [isPaused]);

    const handleDownload = useCallback(() => {
        downloadModel(MODEL);
    }, []);

    return (
        <ThemeProvider theme={darkTheme}>
            <CssBaseline />
            <Box sx={{
                minHeight: '100vh', display: 'flex', flexDirection: 'column',
                bgcolor: 'background.default',
            }}>
                {/* Header */}
                <Box sx={{
                    p: 2, borderBottom: '1px solid #333',
                    display: 'flex', alignItems: 'center', gap: 2,
                }}>
                    <Typography variant="h5" sx={{fontWeight: 700, color: '#e94560'}}>
                        DFS Pangram Search
                    </Typography>
                    <Typography variant="caption" sx={{color: '#666'}}>
                        Using LLM-guided depth-first search to find minimum-length pangrams
                    </Typography>
                </Box>

                {/* Error */}
                {criticalError && (
                    <Box sx={{p: 2, bgcolor: '#4a0000'}}>
                        <Typography color="error">{criticalError}</Typography>
                    </Box>
                )}

                {/* Model loading */}
                {!modelReady && !criticalError && (
                    <Box sx={{p: 3, textAlign: 'center'}}>
                        <Typography sx={{color: '#888', mb: 2}}>{modelStatus}</Typography>
                        {!autoLoaded && modelStatus === 'waiting' && (
                            <Button
                                variant="contained"
                                onClick={handleDownload}
                                sx={{bgcolor: '#e94560', '&:hover': {bgcolor: '#c73e55'}}}
                            >
                                Download Model ({MODEL_SIZE_MB}MB)
                            </Button>
                        )}
                        {modelStatus !== 'waiting' && modelStatus !== 'Model ready' && (
                            <LinearProgress sx={{mt: 1, maxWidth: 400, mx: 'auto'}} />
                        )}
                    </Box>
                )}

                {/* Main content */}
                {modelReady && (
                    <Box sx={{display: 'flex', flexGrow: 1, overflow: 'hidden'}}>
                        {/* Left: Tree visualization */}
                        <Box sx={{
                            flex: 1, overflow: 'auto', p: 2,
                            borderRight: '1px solid #333',
                            fontFamily: 'monospace',
                        }}>
                            <Typography variant="subtitle2" sx={{color: '#888', mb: 1}}>
                                Search Tree
                            </Typography>
                            {rootId ? (
                                <TreeNode nodeId={rootId} isCurrentPath={true} />
                            ) : (
                                <Typography sx={{color: '#555', fontStyle: 'italic'}}>
                                    Press Start to begin the DFS search
                                </Typography>
                            )}
                        </Box>

                        {/* Right: Info panel */}
                        <Box sx={{
                            width: 320, flexShrink: 0, overflow: 'auto',
                            p: 2, display: 'flex', flexDirection: 'column', gap: 2,
                        }}>
                            {/* Controls */}
                            <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                <Box sx={{display: 'flex', gap: 1, flexWrap: 'wrap'}}>
                                    {!isRunning ? (
                                        <Button
                                            variant="contained" size="small"
                                            onClick={handleStart}
                                            sx={{bgcolor: '#4caf50', '&:hover': {bgcolor: '#388e3c'}}}
                                        >
                                            {rootId ? 'Restart' : 'Start'}
                                        </Button>
                                    ) : (
                                        <>
                                            <Button
                                                variant="contained" size="small"
                                                onClick={handlePauseResume}
                                                sx={{bgcolor: '#f0c040', color: '#000', '&:hover': {bgcolor: '#d4a830'}}}
                                            >
                                                {isPaused ? 'Resume' : 'Pause'}
                                            </Button>
                                            <Button
                                                variant="contained" size="small"
                                                onClick={handleStop}
                                                sx={{bgcolor: '#e94560', '&:hover': {bgcolor: '#c73e55'}}}
                                            >
                                                Stop
                                            </Button>
                                        </>
                                    )}
                                </Box>
                            </Paper>

                            {/* Status */}
                            <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                <Typography variant="caption" sx={{color: '#888'}}>Status</Typography>
                                <Typography variant="body2" sx={{color: '#ccc', fontSize: '0.75rem', mt: 0.5}}>
                                    {status}
                                </Typography>
                            </Paper>

                            {/* Current path alphabet */}
                            <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                <Typography variant="caption" sx={{color: '#888'}}>
                                    Letter Coverage ({coverageCount}/26)
                                </Typography>
                                <Box sx={{mt: 0.5}}>
                                    <AlphabetDisplay coveredLetters={currentCovered} />
                                </Box>
                                <LinearProgress
                                    variant="determinate"
                                    value={(coverageCount / 26) * 100}
                                    sx={{
                                        mt: 1, height: 6, borderRadius: 3,
                                        bgcolor: '#2a2a3e',
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: `hsl(${(coverageCount / 26) * 120}, 70%, 45%)`,
                                        },
                                    }}
                                />
                            </Paper>

                            {/* Current sentence */}
                            {currentNode && currentNode.sentence && (
                                <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                    <Typography variant="caption" sx={{color: '#888'}}>
                                        Current Sentence
                                    </Typography>
                                    <Typography variant="body2" sx={{
                                        color: '#ccc', mt: 0.5, fontSize: '0.8rem',
                                        wordBreak: 'break-word',
                                    }}>
                                        "{currentNode.sentence}"
                                    </Typography>
                                </Paper>
                            )}

                            {/* Stats */}
                            <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                <Typography variant="caption" sx={{color: '#888'}}>Stats</Typography>
                                <Box sx={{mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.3}}>
                                    <Stat label="Nodes explored" value={nodesExplored} />
                                    <Stat label="Current depth" value={currentNode?.depth ?? 0} />
                                    <Stat label="Pangrams found" value={pangrams.length} />
                                </Box>
                            </Paper>

                            {/* Best pangram */}
                            {bestPangram && (
                                <Paper sx={{
                                    p: 1.5, bgcolor: '#1b3a1b',
                                    border: '1px solid #4caf50',
                                }}>
                                    <Typography variant="caption" sx={{color: '#4caf50'}}>
                                        Best Pangram ({bestPangram.length} chars)
                                    </Typography>
                                    <Typography variant="body2" sx={{
                                        color: '#8f8', mt: 0.5, fontWeight: 700,
                                        fontSize: '0.85rem', wordBreak: 'break-word',
                                    }}>
                                        "{bestPangram}"
                                    </Typography>
                                </Paper>
                            )}

                            {/* All pangrams */}
                            {pangrams.length > 1 && (
                                <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                    <Typography variant="caption" sx={{color: '#888'}}>
                                        All Pangrams ({pangrams.length})
                                    </Typography>
                                    {pangrams.map((p, i) => (
                                        <Typography key={i} variant="body2" sx={{
                                            color: '#aaa', fontSize: '0.7rem', mt: 0.3,
                                            wordBreak: 'break-word',
                                        }}>
                                            {i + 1}. "{p}" ({p.length}c)
                                        </Typography>
                                    ))}
                                </Paper>
                            )}

                            {/* Legend */}
                            <Paper sx={{p: 1.5, bgcolor: '#1e1e3a'}}>
                                <Typography variant="caption" sx={{color: '#888'}}>Legend</Typography>
                                <Box sx={{mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.3}}>
                                    <LegendItem color="#f0c040" label="Exploring" />
                                    <LegendItem color="#555" label="Pending" />
                                    <LegendItem color="#666" label="Exhausted" />
                                    <LegendItem color="#4caf50" label="Pangram!" />
                                    <LegendItem color="#8b4513" label="Pruned" />
                                </Box>
                            </Paper>
                        </Box>
                    </Box>
                )}
            </Box>
        </ThemeProvider>
    );
}

function Stat({label, value}: {label: string; value: number}) {
    return (
        <Box sx={{display: 'flex', justifyContent: 'space-between'}}>
            <Typography variant="body2" sx={{color: '#888', fontSize: '0.75rem'}}>{label}</Typography>
            <Typography variant="body2" sx={{color: '#ccc', fontSize: '0.75rem', fontWeight: 700}}>
                {value}
            </Typography>
        </Box>
    );
}

function LegendItem({color, label}: {color: string; label: string}) {
    return (
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
            <Box sx={{width: 8, height: 8, borderRadius: '50%', bgcolor: color}} />
            <Typography variant="caption" sx={{color: '#888', fontSize: '0.65rem'}}>{label}</Typography>
        </Box>
    );
}
