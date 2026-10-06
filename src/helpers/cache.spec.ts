import * as boolbase from "boolbase";
import { type Element, isTag, type Node } from "domhandler";
import * as DomUtils from "domutils";
import { parseDocument } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import * as CSSselect from "../index.js";
import type { InternalOptions } from "../types.js";
import { cacheParentResults, ResultCache } from "./cache.js";

const cacheParentResultsOptions = {
    adapter: { ...DomUtils, isTag },
} as unknown as InternalOptions<Node, Element>;

describe("cacheParentResults", () => {
    it("should rely on parent for matches", () => {
        const documentWithoutFoo = parseDocument(
            "<a><b><c><d><e>bar</e></d></c><f><g>bar</g></f></b></a>",
        );

        const isElementContainingFoo = vi.fn((element) =>
            DomUtils.getText(element).includes("foo"),
        );
        const hasfoo = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            cacheParentResultsOptions,
            isElementContainingFoo,
        );

        const options = {
            pseudos: {
                hasfoo,
            },
        };

        expect(
            CSSselect.selectAll<Node, Element>(
                ":hasfoo",
                documentWithoutFoo,
                options,
            ),
        ).toHaveLength(0);

        expect(isElementContainingFoo).toHaveBeenCalledTimes(1);
    });

    it("should cache results for subtrees", () => {
        const documentWithFoo = parseDocument(
            "<a><b><c><d><e>foo</e></d></c><f><g>bar</g></f></b></a>",
        );

        const hasFooInText = vi.fn((element) =>
            DomUtils.getText(element).includes("foo"),
        );
        const hasfoo = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            cacheParentResultsOptions,
            hasFooInText,
        );

        const options = {
            pseudos: {
                hasfoo,
            },
        };

        expect(
            CSSselect.selectAll<Node, Element>(
                ":hasfoo",
                documentWithFoo,
                options,
            ),
        ).toHaveLength(5);

        expect(hasFooInText).toHaveBeenCalledTimes(6);
    });

    it("should use cached result for multiple matches", () => {
        const documentWithFoo = parseDocument(
            "<a><b><c><d><e>foo</e></d></c><f><g>bar</g></f></b></a>",
        );

        const hasFooInText = vi.fn((element) =>
            DomUtils.getText(element).includes("foo"),
        );
        const hasfoo = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            cacheParentResultsOptions,
            hasFooInText,
        );

        const options = {
            pseudos: {
                hasfoo,
            },
        };

        expect(
            CSSselect.selectAll<Node, Element>(
                ":hasfoo :hasfoo",
                documentWithFoo,
                options,
            ),
        ).toHaveLength(4);

        expect(hasFooInText).toHaveBeenCalledTimes(6);
    });

    it("should invalidate cached entries when the generation advances", () => {
        const document = parseDocument("<a><b>bar</b></a>");
        const a = document.children[0] as Element;
        const b = a.children[0] as Element;

        const resultCache = new ResultCache();
        const matches = vi.fn((element: Element) =>
            DomUtils.getText(element).includes("foo"),
        );
        const matcher = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            { ...cacheParentResultsOptions, resultCache },
            matches,
        );

        // Generation 0: neither element contains "foo".
        expect(matcher(b)).toBe(false);
        expect(matches).toHaveBeenCalledTimes(1);
        // The cached negative result is reused within the same generation.
        expect(matcher(b)).toBe(false);
        expect(matches).toHaveBeenCalledTimes(1);

        /*
         * Simulate a mutation changing the descendant, then advance the
         * generation. The stale negative cache entry must not be reused.
         */
        matches.mockImplementation((element: Element) =>
            DomUtils.getText(element).includes("bar"),
        );
        resultCache.advanceGeneration();

        expect(matcher(b)).toBe(true);
        expect(matcher(a)).toBe(true);
    });

    it("should not reuse entries computed with a different adapter", () => {
        const document = parseDocument("<a><b>bar</b></a>");
        const b = (document.children[0] as Element).children[0] as Element;

        const resultCache = new ResultCache();
        const firstAdapter = {
            ...DomUtils,
            isTag,
        } as unknown as InternalOptions<Node, Element>["adapter"];
        const secondAdapter = {
            ...DomUtils,
            isTag,
        } as unknown as InternalOptions<Node, Element>["adapter"];

        const firstMatches = vi.fn(() => true);
        const firstMatcher = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            {
                adapter: firstAdapter,
                resultCache,
            } as unknown as InternalOptions<Node, Element>,
            firstMatches,
        );

        const secondMatches = vi.fn(() => false);
        const secondMatcher = cacheParentResults<Node, Element>(
            boolbase.trueFunc,
            {
                adapter: secondAdapter,
                resultCache,
            } as unknown as InternalOptions<Node, Element>,
            secondMatches,
        );

        expect(firstMatcher(b)).toBe(true);
        /*
         * Results are bound to adapter identity: a matcher built for a
         * distinct adapter computes its own result for the same node rather
         * than reusing the first adapter's cached entry.
         */
        expect(secondMatcher(b)).toBe(false);
        expect(secondMatches).toHaveBeenCalledTimes(1);
    });
});
