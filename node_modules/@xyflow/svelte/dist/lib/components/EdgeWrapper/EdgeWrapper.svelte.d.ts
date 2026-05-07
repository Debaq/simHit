import type { Node, EdgeLayouted, Edge, EdgeEvents } from '../../types';
import type { SvelteFlowStore } from '../../store/types';
declare class __sveltets_Render<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
    props(): {
        store: SvelteFlowStore<NodeType, EdgeType>;
        edge: EdgeLayouted<EdgeType>;
    } & EdgeEvents<EdgeType>;
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
declare const EdgeWrapper: $$IsomorphicComponent;
type EdgeWrapper<NodeType extends Node = Node, EdgeType extends Edge = Edge> = InstanceType<typeof EdgeWrapper<NodeType, EdgeType>>;
export default EdgeWrapper;
