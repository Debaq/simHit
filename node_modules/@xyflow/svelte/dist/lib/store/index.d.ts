import type { Node, Edge } from '../types';
import { type StoreSignals, type SvelteFlowStore } from './types';
export declare const key: unique symbol;
export { useStore } from '../hooks/useStore';
export declare function createStore<NodeType extends Node = Node, EdgeType extends Edge = Edge>(signals: StoreSignals<NodeType, EdgeType>): SvelteFlowStore<NodeType, EdgeType>;
