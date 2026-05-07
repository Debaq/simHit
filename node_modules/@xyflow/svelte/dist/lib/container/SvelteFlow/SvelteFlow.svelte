<script lang="ts" generics="NodeType extends Node = Node, EdgeType extends Edge = Edge">
  import type { Edge, Node } from '../../types';
  import { getContext, setContext, onDestroy, untrack } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { ConnectionLineType, PanOnScrollMode } from '@xyflow/system';

  import { key, createStore } from '../../store';
  import { Zoom } from '../Zoom';
  import { Pane } from '../Pane';
  import { Viewport as ViewportComponent } from '../Viewport';
  import { NodeRenderer } from '../NodeRenderer';
  import { EdgeRenderer } from '../EdgeRenderer';
  import { NodeSelection } from '../../components/NodeSelection';
  import { Selection } from '../../components/Selection';
  import { KeyHandler } from '../../components/KeyHandler';
  import { ConnectionLine } from '../../components/ConnectionLine';
  import { Attribution } from '../../components/Attribution';
  import type { SvelteFlowProps } from './types';
  import { type ProviderContext, type StoreContext } from '../../store/types';
  import Wrapper from './Wrapper.svelte';
  import { A11yDescriptions } from '../../components/A11yDescriptions';

  let {
    width,
    height,
    proOptions,
    selectionKey,
    deleteKey,
    panActivationKey,
    multiSelectionKey,
    zoomActivationKey,
    paneClickDistance = 1,
    nodeClickDistance = 1,
    onmovestart,
    onmoveend,
    onmove,
    oninit,
    onnodeclick,
    onnodecontextmenu,
    onnodedrag,
    onnodedragstart,
    onnodedragstop,
    onnodepointerenter,
    onnodepointermove,
    onnodepointerleave,
    onselectionclick,
    onselectioncontextmenu,
    onselectionstart,
    onselectionend,
    onedgeclick,
    onedgecontextmenu,
    onedgepointerenter,
    onedgepointerleave,
    onpaneclick,
    onpanecontextmenu,
    panOnScrollMode = PanOnScrollMode.Free,
    preventScrolling = true,
    zoomOnScroll = true,
    zoomOnDoubleClick = true,
    zoomOnPinch = true,
    panOnScroll = false,
    panOnScrollSpeed = 0.5,
    panOnDrag = true,
    selectionOnDrag = false,
    connectionLineComponent,
    connectionLineStyle,
    connectionLineContainerStyle,
    connectionLineType = ConnectionLineType.Bezier,
    attributionPosition,
    children,
    nodes = $bindable([]),
    edges = $bindable([]),
    viewport = $bindable(undefined),
    ...props
  }: SvelteFlowProps<NodeType, EdgeType> &
    Omit<HTMLAttributes<HTMLDivElement>, 'onselectionchange'> = $props();

  // svelte-ignore non_reactive_update, state_referenced_locally
  let store = createStore<NodeType, EdgeType>({
    props,
    width,
    height,
    get nodes() {
      return nodes;
    },
    set nodes(newNodes) {
      nodes = newNodes;
    },
    get edges() {
      return edges;
    },
    set edges(newEdges) {
      edges = newEdges;
    },
    get viewport() {
      return viewport;
    },
    set viewport(newViewport) {
      viewport = newViewport;
    }
  });

  // Set store for provider context
  const providerContext = getContext<ProviderContext<NodeType, EdgeType>>(key);
  if (providerContext && providerContext.setStore) {
    providerContext.setStore(store);
  }

  // Overwrite store context to give children direct access
  setContext(key, {
    provider: false,
    getStore() {
      return store;
    }
  } satisfies StoreContext<NodeType, EdgeType>);

  // handle selection change
  $effect(() => {
    const params = { nodes: store.selectedNodes, edges: store.selectedEdges };
    untrack(() => props.onselectionchange)?.(params);
    for (const handler of store.selectionChangeHandlers.values()) {
      handler(params);
    }
  });

  onDestroy(() => {
    store.reset();
  });
</script>

<Wrapper
  bind:domNode={store.domNode}
  bind:clientWidth={store.width}
  bind:clientHeight={store.height}
  colorMode={store.colorMode}
  {width}
  {height}
  rest={props}
>
  <KeyHandler
    bind:store
    {selectionKey}
    {deleteKey}
    {panActivationKey}
    {multiSelectionKey}
    {zoomActivationKey}
  />
  <Zoom
    bind:store
    {panOnScrollMode}
    {preventScrolling}
    {zoomOnScroll}
    {zoomOnDoubleClick}
    {zoomOnPinch}
    {panOnScroll}
    {panOnScrollSpeed}
    {panOnDrag}
    {paneClickDistance}
    {selectionOnDrag}
    {onmovestart}
    {onmove}
    {onmoveend}
    {oninit}
  >
    <Pane
      bind:store
      {onpaneclick}
      {onpanecontextmenu}
      {onselectionstart}
      {onselectionend}
      {panOnDrag}
      {paneClickDistance}
      {selectionOnDrag}
    >
      <ViewportComponent bind:store>
        <div class="svelte-flow__viewport-back svelte-flow__container"></div>
        <EdgeRenderer
          bind:store
          {onedgeclick}
          {onedgecontextmenu}
          {onedgepointerenter}
          {onedgepointerleave}
        />
        <div class="svelte-flow__edge-labels svelte-flow__container"></div>
        <ConnectionLine
          bind:store
          type={connectionLineType}
          LineComponent={connectionLineComponent}
          containerStyle={connectionLineContainerStyle}
          style={connectionLineStyle}
        />
        <NodeRenderer
          bind:store
          {nodeClickDistance}
          {onnodeclick}
          {onnodecontextmenu}
          {onnodepointerenter}
          {onnodepointermove}
          {onnodepointerleave}
          {onnodedrag}
          {onnodedragstart}
          {onnodedragstop}
        />
        <NodeSelection
          bind:store
          {onselectionclick}
          {onselectioncontextmenu}
          {onnodedrag}
          {onnodedragstart}
          {onnodedragstop}
        />
        <div class="svelte-flow__viewport-front svelte-flow__container"></div>
      </ViewportComponent>
      <Selection
        isVisible={!!(store.selectionRect && store.selectionRectMode === 'user')}
        width={store.selectionRect?.width}
        height={store.selectionRect?.height}
        x={store.selectionRect?.x}
        y={store.selectionRect?.y}
      />
    </Pane>
  </Zoom>
  <Attribution {proOptions} position={attributionPosition} />
  <A11yDescriptions {store} />
  {@render children?.()}
</Wrapper>
