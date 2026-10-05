import type { AnyNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import { describe, expect, it, vi } from "vitest";
import * as CSSselect from "../src/index.js";
import type { CompiledQuery, PseudoExtension } from "../src/types.js";

const document = parseDocument(
    `<div id="root">
        <p class="short">hi</p>
        <p class="long">hello world</p>
        <span><b>nested text</b></span>
    </div>`,
);

type Extension = PseudoExtension<AnyNode, Element>;
type Options = CSSselect.Options<AnyNode, Element>;

const missingArgumentAtSix = /requires an argument \(at position 6 /;
const missingArgumentAtTen = /requires an argument \(at position 10 /;
const invalidArgumentMode = /invalid argument mode/;
const alreadyDefined = /already defined/;

/**
 * A pure extension with a required string argument.
 * @param match Optional custom matcher to count invocations of.
 */
const minTextLength = (
    match?: Extension["match"],
): Record<string, Extension> => ({
    "min-text-length": {
        argument: "required",
        argumentType: "string",
        pure: true,
        match:
            match ??
            ((element, argument, options) =>
                options.adapter.getText(element).length >=
                Number(argument as string)),
    },
});

/** An extension taking a nested selector argument. */
const parentIs: Record<string, Extension> = {
    "parent-is": {
        argumentType: "selector",
        match: (element, argument, options) => {
            const parent = options.adapter.getParent(element);
            return (
                parent != null &&
                options.adapter.isTag(parent) &&
                (argument as CompiledQuery<Element>)(parent)
            );
        },
    },
};

/** Throws when any adapter method is called. */
const throwOnAccess = () => {
    throw new Error("DOM accessed during compilation");
};

/**
 * An extension with a configurable `pure` flag, to observe caching.
 * @param pure Whether the extension declares itself as pure.
 * @param match The matcher to count invocations of.
 */
const countedExtension = (
    pure: boolean,
    match: Extension["match"],
): Record<string, Extension> => ({
    counted: { pure, match },
});

describe("pseudo-class extensions", () => {
    describe("compile-time validation", () => {
        it("reports the position when a required argument is missing", () => {
            const options: Options = {
                pseudoExtensions: minTextLength(),
            };

            expect(() =>
                CSSselect.compile("div p:min-text-length", options),
            ).toThrow(
                "Pseudo-class :min-text-length requires an argument (at position 5 in the selector)",
            );
        });

        it("reports positions for nested :not() / :has() arguments", () => {
            const options: Options = {
                pseudoExtensions: minTextLength(),
            };

            expect(() =>
                CSSselect.compile("p:not(:min-text-length)", options),
            ).toThrow(missingArgumentAtSix);
            expect(() =>
                CSSselect.compile("span:has(b:min-text-length)", options),
            ).toThrow(missingArgumentAtTen);
        });

        it("rejects arguments for argument-less extensions", () => {
            const options: Options = {
                pseudoExtensions: {
                    "no-arg": { match: () => true },
                },
            };

            expect(() => CSSselect.compile("p:no-arg(1)", options)).toThrow(
                "Pseudo-class :no-arg doesn't have any arguments",
            );
        });

        it("rejects unknown pseudo-classes", () => {
            expect(() =>
                CSSselect.compile("p:not-registered", {
                    pseudoExtensions: minTextLength(),
                }),
            ).toThrow("Unknown pseudo-class :not-registered");
        });

        it("rejects malformed declarations", () => {
            expect(() =>
                CSSselect.compile("p:broken", {
                    pseudoExtensions: {
                        broken: {} as Extension,
                    },
                }),
            ).toThrow(
                "Pseudo-class extension :broken must declare a match function",
            );

            expect(() =>
                CSSselect.compile("p:broken", {
                    pseudoExtensions: {
                        broken: {
                            argument: "sometimes",
                            match: () => true,
                        } as unknown as Extension,
                    },
                }),
            ).toThrow(invalidArgumentMode);
        });

        it("never calls the matcher or touches the DOM during compilation", () => {
            const match = vi.fn(() => true);
            const adapter = new Proxy(
                {},
                {
                    get: () => throwOnAccess,
                },
            );

            const options: Options = {
                // @ts-expect-error The proxy throws on any DOM access.
                adapter,
                pseudoExtensions: { ...minTextLength(match), ...parentIs },
            };

            expect(() =>
                CSSselect.compile(
                    "p:min-text-length(2):parent-is(div)",
                    options,
                ),
            ).not.toThrow();
            expect(match).toHaveBeenCalledTimes(0);
        });
    });

    describe("same-name overrides", () => {
        it("rejects unauthorized overrides of built-in pseudo-classes", () => {
            expect(() =>
                CSSselect.compile("p:empty", {
                    pseudoExtensions: {
                        empty: { match: () => true },
                    },
                }),
            ).toThrow(
                "Pseudo-class :empty is already defined; set the override flag on the extension to replace it",
            );
        });

        it("rejects unauthorized overrides of legacy pseudos entries", () => {
            expect(() =>
                CSSselect.compile("p:legacy", {
                    pseudos: { legacy: () => true },
                    pseudoExtensions: {
                        legacy: { match: () => true },
                    },
                }),
            ).toThrow(alreadyDefined);
        });

        it("allows explicitly authorized overrides", () => {
            const options: Options = {
                pseudoExtensions: {
                    empty: { override: true, match: () => true },
                },
            };

            // The built-in :empty would not match p elements with text.
            expect(
                CSSselect.selectAll("p:empty", document, options),
            ).toHaveLength(2);
        });
    });

    describe("querying", () => {
        it("queries with legal arguments", () => {
            const options: Options = {
                pseudoExtensions: minTextLength(),
            };

            const matches = CSSselect.selectAll(
                "p:min-text-length(5)",
                document,
                options,
            );
            expect(matches).toHaveLength(1);
            expect(matches[0].attribs["class"]).toBe("long");
        });

        it("supports optional arguments", () => {
            const options: Options = {
                pseudoExtensions: {
                    "opt-arg": {
                        argument: "optional",
                        match: (_element, argument) => argument === null,
                    },
                },
            };

            expect(
                CSSselect.selectAll("p:opt-arg", document, options),
            ).toHaveLength(2);
            expect(
                CSSselect.selectAll("p:opt-arg(1)", document, options),
            ).toHaveLength(0);
        });

        it("parses nested selector arguments with the original parser", () => {
            const options: Options = { pseudoExtensions: parentIs };

            const matches = CSSselect.selectAll(
                "b:parent-is(span)",
                document,
                options,
            );
            expect(matches).toHaveLength(1);
            expect(matches[0].tagName).toBe("b");

            expect(
                CSSselect.selectAll("p:parent-is(div#root)", document, options),
            ).toHaveLength(2);
        });

        it("still parses nested :not() and :has() with the original parser", () => {
            const options: Options = {
                pseudoExtensions: minTextLength(),
            };

            expect(
                CSSselect.selectAll(
                    "p:not(:min-text-length(5))",
                    document,
                    options,
                ),
            ).toHaveLength(1);
            expect(
                CSSselect.selectAll(
                    "span:has(b:min-text-length(5))",
                    document,
                    options,
                ),
            ).toHaveLength(1);
        });

        it("keeps the legacy pseudos entry working", () => {
            expect(
                CSSselect.selectAll("p:legacy", document, {
                    pseudos: { legacy: () => true },
                }),
            ).toHaveLength(2);

            // Legacy entries and extensions can be mixed.
            expect(
                CSSselect.selectAll("p:legacy:min-text-length(5)", document, {
                    pseudos: { legacy: () => true },
                    pseudoExtensions: minTextLength(),
                }),
            ).toHaveLength(1);
        });
    });

    describe("caching", () => {
        it("caches results of pure extensions only", () => {
            const pureMatch = vi.fn(() => true);
            const pureOptions: Options = {
                pseudoExtensions: countedExtension(true, pureMatch),
            };
            const pureQuery = CSSselect.compile("p:counted", pureOptions);

            CSSselect.selectAll(pureQuery, document);
            const pureCallsAfterFirstQuery = pureMatch.mock.calls.length;
            expect(pureCallsAfterFirstQuery).toBeGreaterThan(0);

            CSSselect.selectAll(pureQuery, document);
            // Pure results are cached; the second query adds no calls.
            expect(pureMatch.mock.calls.length).toBe(pureCallsAfterFirstQuery);

            const impureMatch = vi.fn(() => true);
            const impureOptions: Options = {
                pseudoExtensions: countedExtension(false, impureMatch),
            };
            const impureQuery = CSSselect.compile("p:counted", impureOptions);

            CSSselect.selectAll(impureQuery, document);
            const impureCallsAfterFirstQuery = impureMatch.mock.calls.length;
            expect(impureCallsAfterFirstQuery).toBeGreaterThan(0);

            CSSselect.selectAll(impureQuery, document);
            // Impure extensions are never cached.
            expect(impureMatch.mock.calls.length).toBe(
                impureCallsAfterFirstQuery * 2,
            );
        });

        it("does not cache pure extensions when cacheResults is disabled", () => {
            const match = vi.fn(() => true);
            const options: Options = {
                cacheResults: false,
                pseudoExtensions: countedExtension(true, match),
            };
            const query = CSSselect.compile("p:counted", options);

            CSSselect.selectAll(query, document);
            const callsAfterFirstQuery = match.mock.calls.length;
            CSSselect.selectAll(query, document);
            expect(match.mock.calls.length).toBe(callsAfterFirstQuery * 2);
        });
    });
});
