import type { SvelteFlowStore } from '../store/types';
import type { Node, Edge } from '../types';
export declare function useStore<NodeType extends Node = Node, EdgeType extends Edge = Edge>(): SvelteFlowStore<NodeType, EdgeType>;
