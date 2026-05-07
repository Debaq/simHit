import { type OnDrag } from '@xyflow/system';
import type { SvelteFlowStore } from '../../store/types';
import type { Node, Edge } from '../../types';
export type UseDragParams<NodeType extends Node = Node, EdgeType extends Edge = Edge> = {
    store: SvelteFlowStore<NodeType, EdgeType>;
    disabled?: boolean;
    noDragClass?: string;
    handleSelector?: string;
    nodeId?: string;
    isSelectable?: boolean;
    nodeClickDistance?: number;
    onDrag?: OnDrag;
    onDragStart?: OnDrag;
    onDragStop?: OnDrag;
    onNodeMouseDown?: (id: string) => void;
};
export default function drag<NodeType extends Node = Node, EdgeType extends Edge = Edge>(domNode: Element, params: UseDragParams<NodeType, EdgeType>): {
    update(params: UseDragParams<NodeType, EdgeType>): void;
    destroy(): void;
};
