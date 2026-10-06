import { type AnyNode, Element, isTag } from "domhandler";
import * as DomUtils from "domutils";
import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import * as CSSselect from "../src/index.js";
import type { Adapter } from "../src/types.js";

/**
 * Directed acceptance tests for the explicit DOM generation cache.
 *
 * `:has()` results depend on descendants and are memoized. After the caller
 * mutates the DOM and advances the generation, stale results must not be
 * reused. The cache is additionally bound to the queried DOM (via the node)
 * and to the adapter identity.
 */
describe("explicit generation cache", () => {
    it("invalidates cached :has() results after advancing the generation", () => {
        // Parent initially has no descendant matching `.x`.
        const document = parseDocument("<div><span></span></div>");
        const parent = document.children[0] as Element;

        const resultCache = new CSSselect.ResultCache();
        const matches = CSSselect.compile<AnyNode, Element>(":has(.x)", {
            resultCache,
        });

        // Query 1: no `.x` descendant -> does not match.
        expect(CSSselect.is(parent, matches)).toBe(false);

        // Mutate the DOM and explicitly advance the generation.
        DomUtils.appendChild(parent, new Element("i", { class: "x" }));

        // Without advancing, the stale "no match" result must still be reused.
        expect(CSSselect.is(parent, matches)).toBe(false);

        resultCache.advanceGeneration();

        // Query 2 (new generation): the added descendant now matches.
        expect(CSSselect.is(parent, matches)).toBe(true);

        // Query 3 (same generation): the fresh result is cached and reused.
        expect(CSSselect.is(parent, matches)).toBe(true);
    });

    it("does not reuse results from another DOM tree", () => {
        const first = parseDocument("<div></div>");
        const second = parseDocument('<div><i class="x"></i></div>');
        const firstParent = first.children[0] as Element;
        const secondParent = second.children[0] as Element;

        const resultCache = new CSSselect.ResultCache();
        const matches = CSSselect.compile<AnyNode, Element>(":has(.x)", {
            resultCache,
        });

        // Query 1: parent without a `.x` descendant.
        expect(CSSselect.is(firstParent, matches)).toBe(false);

        /*
         * Query 2: a different DOM tree with a matching descendant must not
         * reuse the first tree's negative result.
         */
        expect(CSSselect.is(secondParent, matches)).toBe(true);

        // Query 3: back on the first tree, the negative result still holds.
        expect(CSSselect.is(firstParent, matches)).toBe(false);
    });

    it("does not reuse results computed with another adapter", () => {
        const document = parseDocument('<div><i class="x"></i></div>');
        const parent = document.children[0] as Element;

        const resultCache = new CSSselect.ResultCache();

        /*
         * Adapter A reports no element children (so `:has()` can never match),
         * while adapter B uses the real DOM structure.
         */
        const emptyChildrenAdapter = {
            ...DomUtils,
            isTag,
            getChildren: () => [],
        } as unknown as Adapter<AnyNode, Element>;
        const realAdapter = {
            ...DomUtils,
            isTag,
        } as unknown as Adapter<AnyNode, Element>;

        const matchesWithoutChildren = CSSselect.compile<AnyNode, Element>(
            ":has(.x)",
            { resultCache, adapter: emptyChildrenAdapter },
        );
        const matchesWithChildren = CSSselect.compile<AnyNode, Element>(
            ":has(.x)",
            { resultCache, adapter: realAdapter },
        );

        // Query 1: adapter A hides children -> no match.
        expect(CSSselect.is(parent, matchesWithoutChildren)).toBe(false);

        // Query 2: a different adapter must not reuse adapter A's result.
        expect(CSSselect.is(parent, matchesWithChildren)).toBe(true);

        // Query 3: adapter A still yields its own (negative) result.
        expect(CSSselect.is(parent, matchesWithoutChildren)).toBe(false);
    });
});
