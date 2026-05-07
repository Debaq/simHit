import type { Snippet } from 'svelte';
import type { Node, Edge, PaneEvents } from '../../types';
import type { SvelteFlowStore } from '../../store/types';
export type PaneProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = {
    store: SvelteFlowStore<NodeType, EdgeType>;
    panOnDrag?: boolean | number[];
    paneClickDistance: number;
    selectionOnDrag?: boolean;
    onselectionstart?: (event: PointerEvent) => void;
    onselectionend?: (event: PointerEvent) => void;
    children: Snippet;
} & PaneEvents;
