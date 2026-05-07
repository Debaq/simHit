import { useStore } from './useStore';
export function useOnSelectionChange(onselectionchange) {
    const store = $derived(useStore());
    const symbol = Symbol();
    $effect(() => {
        store.selectionChangeHandlers.set(symbol, onselectionchange);
        return () => {
            store.selectionChangeHandlers.delete(symbol);
        };
    });
}
