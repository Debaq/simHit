import type { HTMLAttributes } from 'svelte/elements';
import type { Snippet } from 'svelte';
import { type SvelteFlowRestProps } from '../../store/types';
import type { Node, Edge } from '../../types';
declare class __sveltets_Render<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
    props(): {
        width?: number;
        height?: number;
        colorMode?: string;
        domNode: HTMLDivElement | null;
        clientWidth?: number;
        clientHeight?: number;
        children?: Snippet;
        rest: SvelteFlowRestProps<NodeType, EdgeType> & Omit<HTMLAttributes<HTMLDivElement>, "onselectionchange">;
    };
    events(): {};
    slots(): {};
    bindings(): "domNode" | "clientHeight" | "clientWidth";
    exports(): {};
}
interface $$IsomorphicComponent {
    new <NodeType extends Node = Node, EdgeType extends Edge = Edge>(options: import('svelte').ComponentConstructorOptions<ReturnType<__sveltets_Render<NodeType, EdgeType>['props']>>): import('svelte').SvelteComponent<ReturnType<__sveltets_Render<NodeType, EdgeType>['props']>, ReturnType<__sveltets_Render<NodeType, EdgeType>['events']>, ReturnType<__sveltets_Render<NodeType, EdgeType>['slots']>> & {
        $$bindings?: ReturnType<__sveltets_Render<NodeType, EdgeType>['bindings']>;
    } & ReturnType<__sveltets_Render<NodeType, EdgeType>['exports']>;
    <NodeType extends Node = Node, EdgeType extends Edge = Edge>(internal: unknown, props: ReturnType<__sveltets_Render<NodeType, EdgeType>['props']> & {}): ReturnType<__sveltets_Render<NodeType, EdgeType>['exports']>;
    z_$$bindings?: ReturnType<__sveltets_Render<any, any>['bindings']>;
}
declare const Wrapper: $$IsomorphicComponent;
type Wrapper<NodeType extends Node = Node, EdgeType extends Edge = Edge> = InstanceType<typeof Wrapper<NodeType, EdgeType>>;
export default Wrapper;
