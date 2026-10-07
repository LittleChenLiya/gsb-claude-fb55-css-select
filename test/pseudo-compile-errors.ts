import type { AnyNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import * as CSSselect from "../src/index.js";
import { PseudoClassCompileError } from "../src/index.js";
import type { Options } from "../src/types.js";

// Small in-memory fixture for checking that valid queries still work.
const dom = parseDocument(
    '<div id="root"><p class="a">one</p><p class="b">two</p></div>',
);

const options: Options<AnyNode, Element> = {
    pseudos: {
        // Custom pseudo that requires an argument.
        foovalue(element, data) {
            return data != null && element.attribs["class"] === data;
        },
        // Custom pseudo alias that fails to parse.
        broken: ">>>",
    },
};

function getError(compile: () => unknown): unknown {
    try {
        compile();
    } catch (error) {
        return error;
    }
    throw new Error("Expected function to throw");
}

describe("custom pseudo-class compile errors", () => {
    it("should add name and position to custom pseudo errors, keeping the cause", () => {
        const error = getError(() => CSSselect.compile(":foovalue", options));

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        const compileError = error as PseudoClassCompileError;
        expect(compileError.pseudoName).toBe("foovalue");
        expect(compileError.groupIndex).toBe(0);
        expect(compileError.ruleIndex).toBe(0);
        expect(compileError.message).toBe(
            "Failed to compile custom pseudo-class :foovalue at group 1, rule 1: " +
                "Pseudo-class :foovalue requires an argument",
        );
        // The original error is preserved as `cause`.
        expect(compileError.cause).toBeInstanceOf(Error);
        expect((compileError.cause as Error).message).toBe(
            "Pseudo-class :foovalue requires an argument",
        );
    });

    it("should wrap failing custom pseudo aliases with the cause", () => {
        const error = getError(() => CSSselect.compile("p:broken", options));

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        const compileError = error as PseudoClassCompileError;
        expect(compileError.pseudoName).toBe("broken");
        expect(compileError.groupIndex).toBe(0);
        expect(compileError.ruleIndex).toBe(1);
        expect(compileError.message).toContain(":broken");
        expect(compileError.message).toContain("group 1, rule 2");
        expect(compileError.cause).toBeInstanceOf(Error);
    });

    it("should keep the original message for custom pseudos with arguments", () => {
        const error = getError(() =>
            CSSselect.compile(":foovalue(boo)", {
                pseudos: { foovalue: "tag" },
            }),
        );

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        // The original message is still part of the wrapped message.
        expect((error as Error).message).toContain(
            "doesn't have any arguments",
        );
    });

    it("should only locate the failing group in grouped selectors", () => {
        const error = getError(() =>
            CSSselect.compile("div, p:foovalue, span", options),
        );

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        const compileError = error as PseudoClassCompileError;
        expect(compileError.pseudoName).toBe("foovalue");
        // Only the second group failed; the first and third are fine.
        expect(compileError.groupIndex).toBe(1);
        expect(compileError.ruleIndex).toBe(1);
        expect(compileError.message).toContain("group 2, rule 2");
    });

    it("should locate the failing rule within a group", () => {
        const error = getError(() =>
            CSSselect.compile("div > span:foovalue", options),
        );

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        const compileError = error as PseudoClassCompileError;
        expect(compileError.groupIndex).toBe(0);
        expect(compileError.ruleIndex).toBe(3);
    });

    it("should keep the innermost position for nested sub-selectors", () => {
        const error = getError(() =>
            CSSselect.compile(":is(p:foovalue)", options),
        );

        expect(error).toBeInstanceOf(PseudoClassCompileError);
        const compileError = error as PseudoClassCompileError;
        // Position within the `:is(…)` sub-selector, not the outer token.
        expect(compileError.groupIndex).toBe(0);
        expect(compileError.ruleIndex).toBe(1);
    });

    it("should still report unknown pseudo-classes with the original error", () => {
        const error = getError(() => CSSselect.compile(":unmatched"));

        expect(error).not.toBeInstanceOf(PseudoClassCompileError);
        expect((error as Error).message).toBe(
            "Unknown pseudo-class :unmatched",
        );
        expect(
            getError(() => CSSselect.selectAll(":unmatched(foo)", dom)),
        ).not.toBeInstanceOf(PseudoClassCompileError);
    });

    it("should not leave a reusable half-finished function behind", () => {
        // A failing group after a valid one must not produce a partial query.
        expect(
            getError(() => CSSselect.compile("p.a, p:foovalue", options)),
        ).toBeInstanceOf(PseudoClassCompileError);

        // The next valid compile works as usual.
        const query = CSSselect.compile(":foovalue(a)", options);
        expect(typeof query).toBe("function");
        const matches = CSSselect.selectAll(query, dom);
        expect(matches).toHaveLength(1);
        expect(matches[0]).toHaveProperty("attribs.class", "a");

        // Querying with a valid selector directly also still works.
        expect(CSSselect.selectAll(":foovalue(b)", dom, options)).toHaveLength(
            1,
        );
    });
});
