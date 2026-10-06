import type {
    Adapter,
    CompiledQuery,
    InternalOptions,
    ResultCacheLike,
} from "../types.js";
import { getElementParent } from "./querying.js";

/**
 * Explicit DOM generation cache.
 *
 * The caller advances the generation after mutating the DOM (e.g. after adding
 * or removing descendants). Selector results that were memoized for an older
 * generation are then considered stale and recomputed. This cache neither
 * snapshots in-flight queries nor observes the DOM; invalidation is entirely
 * caller-driven.
 */
export class ResultCache implements ResultCacheLike {
    private generation = 0;

    getGeneration(): number {
        return this.generation;
    }

    advanceGeneration(): void {
        this.generation += 1;
    }
}

/**
 * Default generation cache used when the caller does not provide an explicit
 * one. Its generation never advances, preserving the previous behavior where
 * a single compiled selector assumes the queried DOM is stable.
 */
class StaticResultCache implements ResultCacheLike {
    private static readonly GENERATION = 0;

    getGeneration(): number {
        return StaticResultCache.GENERATION;
    }

    advanceGeneration(): void {
        // No-op: callers opt into explicit invalidation by passing their own cache.
    }
}

const defaultResultCache: ResultCacheLike = new StaticResultCache();

/**
 * Memoized result for a single node. The entry is only reusable while the DOM
 * generation and the adapter identity match those used to compute it.
 */
interface CachedResult<Node, ElementNode extends Node> {
    result: boolean;
    generation: number;
    adapter: Adapter<Node, ElementNode>;
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
 * When the options include an explicit {@link ResultCacheLike}, cached entries
 * are bound to the cache's current DOM generation and to the active adapter.
 * After the caller mutates the DOM and advances the generation, stale results
 * (including `:has()` results that depend on descendants) are recomputed.
 * Results for one DOM tree or adapter are never reused for another.
 * @param next Matcher to run after this matcher succeeds.
 * @param options Configuration object for cache behavior.
 * @param options.adapter Adapter implementation used for DOM access.
 * @param options.cacheResults Whether results should be memoized by input root.
 * @param options.resultCache Optional explicit generation cache.
 * @param matches Compiled matcher function to wrap with caching.
 */
export function cacheParentResults<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    {
        adapter,
        cacheResults,
        resultCache = defaultResultCache,
    }: InternalOptions<Node, ElementNode>,
    matches: (element: ElementNode) => boolean,
): CompiledQuery<ElementNode> {
    if (cacheResults === false || typeof WeakMap === "undefined") {
        return (element) => next(element) && matches(element);
    }

    /*
     * Use a cache to avoid re-checking children of an element. The WeakMap keys
     * results to the DOM node they were computed for, so separate DOM trees can
     * never share entries.
     */

    // @ts-expect-error `Node` is not extending object
    const cacheByNode = new WeakMap<Node, CachedResult<Node, ElementNode>>();

    function isReusable(
        cached: CachedResult<Node, ElementNode> | undefined,
        generation: number,
    ): cached is CachedResult<Node, ElementNode> {
        return (
            cached !== undefined &&
            cached.adapter === adapter &&
            cached.generation === generation
        );
    }

    function addResultToCache(
        element: ElementNode,
        generation: number,
    ): boolean {
        const result = matches(element);

        cacheByNode.set(element, { result, generation, adapter });
        return result;
    }

    return function cachedMatcher(element) {
        if (!next(element)) {
            return false;
        }

        const generation = resultCache.getGeneration();

        const cachedForElement = cacheByNode.get(element);

        if (isReusable(cachedForElement, generation)) {
            return cachedForElement.result;
        }

        /*
         * Check all of the element's parents. A parent known to match lets this
         * element match; a parent known not to match rules it out.
         */
        let node = element;
        let parent = getElementParent(node, adapter);

        while (parent !== null) {
            node = parent;

            const cachedForParent = cacheByNode.get(node);

            if (isReusable(cachedForParent, generation)) {
                return cachedForParent.result
                    ? addResultToCache(element, generation)
                    : false;
            }

            // Stale parent entry: keep walking up to find a fresh ancestor.
            parent = getElementParent(node, adapter);
        }

        return addResultToCache(element, generation);
    };
}
