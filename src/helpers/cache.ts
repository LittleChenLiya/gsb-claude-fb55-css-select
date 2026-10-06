import type { CompiledQuery, InternalOptions } from "../types.js";
import { getElementParent } from "./querying.js";

interface CacheEntry {
    version: number;
    result: boolean;
}

/**
 * Some selectors such as `:contains` and (non-relative) `:has` will only be
 * able to match elements if their parents match the selector (as they contain
 * a subset of the elements that the parent contains).
 *
 * This function wraps the given `matches` function in a function that caches
 * the results of the parent elements, so that the `matches` function only
 * needs to be called once for each subtree.
 *
 * If a `generation` is provided in the options, cached results are tied to
 * the current generation version. When the generation advances, all cached
 * results are invalidated and will be recomputed on the next call.
 * @param next Matcher to run after this matcher succeeds.
 * @param options Configuration object for cache behavior.
 * @param options.adapter Adapter implementation used for DOM access.
 * @param options.cacheResults Whether results should be memoized by input root.
 * @param options.generation Optional generation tracker for cache invalidation.
 * @param matches Compiled matcher function to wrap with caching.
 */
export function cacheParentResults<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    { adapter, cacheResults, generation }: InternalOptions<Node, ElementNode>,
    matches: (element: ElementNode) => boolean,
): CompiledQuery<ElementNode> {
    if (cacheResults === false || typeof WeakMap === "undefined") {
        return (element) => next(element) && matches(element);
    }

    // Use a cache to avoid re-checking children of an element.

    // @ts-expect-error `Node` is not extending object
    const resultCache = new WeakMap<Node, CacheEntry>();

    function addResultToCache(element: ElementNode): boolean {
        const result = matches(element);

        resultCache.set(element, {
            version: generation?.version ?? 0,
            result,
        });
        return result;
    }

    return function cachedMatcher(element) {
        if (!next(element)) {
            return false;
        }

        const cached = resultCache.get(element);

        if (
            cached !== undefined &&
            (generation === undefined || cached.version === generation.version)
        ) {
            return cached.result;
        }

        // Check all of the element's parents.
        let node = element;
        let parent: ElementNode | null;

        while ((parent = getElementParent(node, adapter)) !== null) {
            node = parent;

            const parentCached = resultCache.get(node);

            if (
                parentCached !== undefined &&
                (generation === undefined ||
                    parentCached.version === generation.version)
            ) {
                return parentCached.result ? addResultToCache(element) : false;
            }
        }

        return addResultToCache(element);
    };
}
