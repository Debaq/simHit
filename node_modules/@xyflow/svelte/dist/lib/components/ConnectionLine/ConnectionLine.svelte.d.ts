import type { Component } from 'svelte';
import { ConnectionLineType } from '@xyflow/system';
import type { SvelteFlowStore } from '../../store/types';
import type { Node, Edge } from '../../types';
declare class __sveltets_Render<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
    props(): {
        store: SvelteFlowStore<NodeType, EdgeType>;
        type: ConnectionLineType;
        containerStyle?: string;
        style?: string;
        LineComponent?: Component;
    };
    events(): {};
    slots(): {};
    bindings(): "store";
    exports(): {};
}
interface $$IsomorphicComponent {
    new <NodeType extends Node = Node, EdgeType extends Edge = Edge>(options: import('svelte').ComponentConstructorOptions<ReturnType<__sveltets_Render<NodeType, EdgeType>['props']>>): import('svelte').SvelteComponent<ReturnType<__sveltets_Render<NodeType, EdgeType>['props']>, ReturnType<__sveltets_Render<NodeType, EdgeType>['events']>, ReturnType<__sveltets_Render<NodeType, EdgeType>['slots']>> & {
        $$bindings?: ReturnType<__sveltets_Render<NodeType, EdgeType>['bindings']>;
    } & ReturnType<__sveltets_Render<NodeType, EdgeType>['exports']>;
    <NodeType extends Node = Node, EdgeType extends Edge = Edge>(internal: unknown, props: ReturnType<__sveltets_Render<NodeType, EdgeType>['props']> & {}): ReturnType<__sveltets_Render<NodeType, EdgeType>['exports']>;
    z_$$bindings?: ReturnType<__sveltets_Render<any, any>['bindings']>;
}
declare const ConnectionLine: $$IsomorphicComponent;
type ConnectionLine<NodeType extends Node = Node, EdgeType extends Edge = Edge> = InstanceType<typeof ConnectionLine<NodeType, EdgeType>>;
export default ConnectionLine;
