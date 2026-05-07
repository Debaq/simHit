import { useStore } from '../store';
/**
 * Hook for receiving the current connection.
 *
 * @public
 * @returns Current connection as a signal
 */
export function useConnection() {
    const { connection } = $derived(useStore());
    return {
        get current() {
            return connection;
        }
    };
}
