import { Element, isTag } from "domhandler";
import * as DomUtils from "domutils";
import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import * as CSSselect from "../src/index.js";
import { Generation } from "../src/index.js";
import type { Adapter } from "../src/types.js";

describe("Generation cache", () => {
    it("should not reuse stale :has results after generation advance", () => {
        // Parent initially does not match :has(.x).
        const document = parseDocument("<div><p>hello</p></div>");
        const [parent] = document.children as Element[];

        const generation = new Generation();
        const query = CSSselect.compile<Element, Element>(":has(.x)", {
            generation,
        });

        // First query: parent does not match :has(.x).
        expect(query(parent)).toBe(false);

        // Add a child node with class "x".
        const child = new Element("span", { class: "x" });
        DomUtils.appendChild(parent, child);

        // Advance the generation so the stale result is not reused.
        generation.advance();

        // Second query: parent now matches :has(.x).
        expect(query(parent)).toBe(true);
    });

    it("should reuse stale results when generation does not advance", () => {
        const document = parseDocument("<div><p>hello</p></div>");
        const [parent] = document.children as Element[];

        const generation = new Generation();
        const query = CSSselect.compile<Element, Element>(":has(.x)", {
            generation,
        });

        // First query: does not match.
        expect(query(parent)).toBe(false);

        // Add a child node with class "x" but do NOT advance the generation.
        const child = new Element("span", { class: "x" });
        DomUtils.appendChild(parent, child);

        // Second query: stale result is reused (generation did not advance).
        expect(query(parent)).toBe(false);

        // Advance the generation.
        generation.advance();

        // Third query: result is recomputed and now matches.
        expect(query(parent)).toBe(true);
    });

    it("should not reuse results across different DOMs", () => {
        // DOM A: parent does not match :has(.x).
        const documentA = parseDocument("<div><p>hello</p></div>");
        const [parentA] = documentA.children as Element[];

        // DOM B: parent matches :has(.x).
        const documentB = parseDocument('<div><span class="x"></span></div>');
        const [parentB] = documentB.children as Element[];

        const generation = new Generation();
        const query = CSSselect.compile<Element, Element>(":has(.x)", {
            generation,
        });

        // Query DOM A: does not match.
        expect(query(parentA)).toBe(false);

        // Query DOM B: matches (must not reuse DOM A's result).
        expect(query(parentB)).toBe(true);
    });

    it("should not reuse results across different adapters", () => {
        const document = parseDocument("<div><p>hello</p></div>");
        const [parent] = document.children as Element[];

        const generation = new Generation();

        // Default adapter.
        const defaultQuery = CSSselect.compile<Element, Element>(":has(.x)", {
            generation,
        });

        // Custom adapter wrapping the default adapter with a distinct identity.
        const customAdapter: Adapter<Element, Element> = {
            ...DomUtils,
            isTag,
        };
        const customQuery = CSSselect.compile<Element, Element>(":has(.x)", {
            adapter: customAdapter,
            generation,
        });

        // Query with default adapter: does not match.
        expect(defaultQuery(parent)).toBe(false);

        // Query with custom adapter: must not reuse the default adapter's result.
        expect(customQuery(parent)).toBe(false);

        // Add a child node with class "x".
        const child = new Element("span", { class: "x" });
        DomUtils.appendChild(parent, child);

        // Advance the generation.
        generation.advance();

        // Both adapters should now report a match.
        expect(defaultQuery(parent)).toBe(true);
        expect(customQuery(parent)).toBe(true);
    });
});
