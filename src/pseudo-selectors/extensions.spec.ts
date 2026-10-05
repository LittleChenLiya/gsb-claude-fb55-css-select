import type { Selector } from "css-what";
import { type AnyNode, type Element, isTag } from "domhandler";
import * as DomUtils from "domutils";
import { parseDocument } from "htmlparser2";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as CSSselect from "../index.js";
import type { Adapter } from "../types.js";
import {
    getRegisteredPseudo,
    isBuiltinPseudo,
    registerPseudo,
    unregisterPseudo,
} from "./extensions.js";

const adapter: Adapter<AnyNode, Element> = { ...DomUtils, isTag };

afterEach(() => {
    for (const name of ["custom", "sel", "pure", "impure", "dup", "legacy"]) {
        unregisterPseudo(name);
    }
});

describe("registerPseudo", () => {
    it("matches elements with a string argument", () => {
        registerPseudo<AnyNode, Element>({
            name: "custom",
            required: true,
            match: (element, data) => DomUtils.getText(element) === data,
        });

        const dom = parseDocument("<div><p>foo</p><p>bar</p></div>");
        const result = CSSselect.selectAll<AnyNode, Element>(
            ":custom(foo)",
            dom,
            {
                adapter,
            },
        );

        expect(result).toHaveLength(1);
        expect(DomUtils.getText(result[0])).toBe("foo");
    });

    it("throws at compile time when a required argument is missing", () => {
        registerPseudo<AnyNode, Element>({
            name: "custom",
            required: true,
            match: () => true,
        });

        expect(() => CSSselect.compile(":custom", { adapter })).toThrow(
            "Pseudo-class :custom requires an argument",
        );
        expect(() =>
            CSSselect.compile(":custom(foo)", { adapter }),
        ).not.toThrow();
    });

    it("parses selector arguments at compile time", () => {
        registerPseudo<AnyNode, Element>({
            name: "sel",
            required: true,
            argument: "selector",
            match: (element, data, options) =>
                data != null && CSSselect.is(element, data, options),
        });

        const dom = parseDocument("<div><p>foo</p><span>bar</span></div>");
        const result = CSSselect.selectAll<AnyNode, Element>(":sel(p)", dom, {
            adapter,
        });

        expect(result).toHaveLength(1);
        expect(DomUtils.getText(result[0])).toBe("foo");

        // Malformed selector arguments are rejected at compile time.
        expect(() => CSSselect.compile(":sel(foo", { adapter })).toThrow(
            "Parenthesis not matched",
        );
    });

    it("rejects selector arguments that fail to parse", () => {
        registerPseudo<AnyNode, Element>({
            name: "sel",
            argument: "selector",
            match: () => true,
        });

        /*
         * The argument passes the outer parse but fails the inner selector
         * parse, so it is rejected at compile time with the pseudo name.
         */
        expect(() =>
            CSSselect.compile(":sel(foo[attr=bar)", { adapter }),
        ).toThrow("Pseudo-class :sel");
    });

    it("never calls the matcher during compilation", () => {
        const match = vi.fn(() => true);
        registerPseudo<AnyNode, Element>({ name: "custom", match });

        CSSselect.compile(":custom", { adapter });
        CSSselect.compile(":custom(foo)", { adapter });

        expect(match).not.toHaveBeenCalled();
    });

    it("caches results only for cacheable extensions", () => {
        const pureMatch = vi.fn(() => true);
        registerPseudo<AnyNode, Element>({
            name: "pure",
            cacheable: true,
            match: pureMatch,
        });
        const impureMatch = vi.fn(() => true);
        registerPseudo<AnyNode, Element>({
            name: "impure",
            cacheable: false,
            match: impureMatch,
        });

        const dom = parseDocument("<div><p>a</p><p>b</p></div>");

        const pureQuery = CSSselect.compile(":pure", { adapter });
        expect(CSSselect.selectAll(pureQuery, dom)).toHaveLength(3);
        expect(pureMatch).toHaveBeenCalledTimes(3);
        expect(CSSselect.selectAll(pureQuery, dom)).toHaveLength(3);
        expect(pureMatch).toHaveBeenCalledTimes(3);

        const impureQuery = CSSselect.compile(":impure", { adapter });
        expect(CSSselect.selectAll(impureQuery, dom)).toHaveLength(3);
        expect(impureMatch).toHaveBeenCalledTimes(3);
        expect(CSSselect.selectAll(impureQuery, dom)).toHaveLength(3);
        expect(impureMatch).toHaveBeenCalledTimes(6);
    });

    it("does not cache when cacheResults is disabled", () => {
        const match = vi.fn(() => true);
        registerPseudo<AnyNode, Element>({
            name: "pure",
            cacheable: true,
            match,
        });

        const dom = parseDocument("<div><p>a</p><p>b</p></div>");
        const query = CSSselect.compile(":pure", {
            adapter,
            cacheResults: false,
        });

        CSSselect.selectAll(query, dom);
        expect(match).toHaveBeenCalledTimes(3);
        CSSselect.selectAll(query, dom);
        expect(match).toHaveBeenCalledTimes(6);
    });

    it("rejects same-name overrides without authorization", () => {
        registerPseudo<AnyNode, Element>({ name: "dup", match: () => true });

        expect(() =>
            registerPseudo<AnyNode, Element>({
                name: "dup",
                match: () => false,
            }),
        ).toThrow("already exists");

        expect(() =>
            registerPseudo<AnyNode, Element>({
                name: "empty",
                match: () => true,
            }),
        ).toThrow("already exists");
    });

    it("allows same-name overrides with authorization", () => {
        registerPseudo<AnyNode, Element>({ name: "dup", match: () => true });

        expect(() =>
            registerPseudo<AnyNode, Element>(
                { name: "dup", match: () => false },
                { override: true },
            ),
        ).not.toThrow();

        expect(getRegisteredPseudo("dup")).toBeDefined();
    });

    it("still rejects unknown pseudo-classes", () => {
        expect(() => CSSselect.compile(":nope", { adapter })).toThrow(
            "Unknown pseudo-class :nope",
        );
    });

    it("keeps the old pseudos option working", () => {
        const dom = parseDocument("<div><p>foo</p></div>");

        const result = CSSselect.selectAll<AnyNode, Element>(
            ":legacy(foo)",
            dom,
            {
                adapter,
                pseudos: {
                    legacy: (element, data) =>
                        adapter.getName(element) === "p" &&
                        DomUtils.getText(element) === data,
                },
            },
        );

        expect(result).toHaveLength(1);
    });

    it("checks extensions nested in :not and :has", () => {
        registerPseudo<AnyNode, Element>({
            name: "custom",
            required: true,
            match: (element, data) => DomUtils.getText(element) === data,
        });

        const dom = parseDocument("<div><p>foo</p><p>bar</p></div>");

        expect(
            CSSselect.selectAll<AnyNode, Element>("p:not(:custom(foo))", dom, {
                adapter,
            }),
        ).toHaveLength(1);
        expect(
            CSSselect.selectAll<AnyNode, Element>(":has(:custom(foo))", dom, {
                adapter,
            }),
        ).toHaveLength(1);

        expect(() => CSSselect.compile("p:not(:custom)", { adapter })).toThrow(
            "Pseudo-class :custom requires an argument",
        );
    });

    it("exposes built-in status", () => {
        expect(isBuiltinPseudo("empty")).toBe(true);
        expect(isBuiltinPseudo("not")).toBe(true);
        expect(isBuiltinPseudo("custom")).toBe(false);
    });

    it("passes null data when an optional argument is omitted", () => {
        const match = vi.fn(
            (_element: Element, data: string | Selector[][] | null) =>
                data == null,
        );
        registerPseudo<AnyNode, Element>({
            name: "custom",
            match,
        });

        const dom = parseDocument("<div><p>foo</p></div>");
        expect(CSSselect.selectAll(":custom", dom, { adapter })).toHaveLength(
            2,
        );
        expect(match).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.anything(),
        );
    });
});
