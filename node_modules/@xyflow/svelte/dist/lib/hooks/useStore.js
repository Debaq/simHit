import { getContext } from 'svelte';
import { key } from '../store';
export function useStore() {
    const storeContext = getContext(key);
    if (!storeContext) {
        throw new Error('To call useStore outside of <SvelteFlow /> you need to wrap your component in a <SvelteFlowProvider />');
    }
    return storeContext.getStore();
}
