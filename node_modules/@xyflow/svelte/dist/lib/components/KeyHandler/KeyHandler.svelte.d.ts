import type { KeyHandlerProps } from './types';
import type { Node, Edge } from '../../types';
declare class __sveltets_Render<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
    props(): KeyHandlerProps<NodeType, EdgeType>;
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
declare const KeyHandler: $$IsomorphicComponent;
type KeyHandler<NodeType extends Node = Node, EdgeType extends Edge = Edge> = InstanceType<typeof KeyHandler<NodeType, EdgeType>>;
export default KeyHandler;
