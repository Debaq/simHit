import type { InternalNode } from '../types';
/**
 * Hook to get an internal node by id.
 *
 * @public
 * @param id - the node id
 * @returns An internal node or undefined
 */
export declare function useInternalNode(id: string): {
    current: InternalNode | undefined;
};
