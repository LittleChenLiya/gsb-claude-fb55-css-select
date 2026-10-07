import { type Element, isTag } from "domhandler";
import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import * as CSSselect from "../src/index.js";

/*
 * Small in-memory fixture: two nested `<div>` roots, each queryable, with
 * two leaf spans below the inner root.
 */
const document = parseDocument(`
    <div class="outer" id="outer">
        <div class="root" id="root">
            <span class="leaf" id="s1"></span>
            <span class="leaf" id="s2"></span>
        </div>
    </div>`);

const outer = document.children.find(isTag) as Element;
const root = outer.children.find(isTag) as Element;

const ids = (elements: Element[]) =>
    elements.map((element) => element.attribs["id"]);

describe("root boundary", () => {
    describe("query root itself", () => {
        it("should match the root itself with an explicit `:scope`", () => {
            expect(ids(CSSselect.selectAll(":scope", root))).toStrictEqual([
                "root",
            ]);
            expect(CSSselect.selectOne(":scope", root)).toBe(root);
        });

        it("should match the root in `:scope` compounds", () => {
            expect(ids(CSSselect.selectAll("div:scope", root))).toStrictEqual(
                ["root"],
            );
            expect(
                ids(CSSselect.selectAll("span:scope", root)),
            ).toStrictEqual([]);
            expect(
                ids(CSSselect.selectAll(":scope, .nope", root)),
            ).toStrictEqual(["root"]);
        });

        it("should not include the root in plain descendant queries", () => {
            expect(ids(CSSselect.selectAll("div", root))).toStrictEqual([]);
            expect(ids(CSSselect.selectAll(".root", root))).toStrictEqual([]);
        });

        it("should keep `:scope` pointing at the root for descendants", () => {
            expect(
                ids(CSSselect.selectAll(":scope > span", root)),
            ).toStrictEqual(["s1", "s2"]);
            expect(
                ids(CSSselect.selectAll(":scope span", root)),
            ).toStrictEqual(["s1", "s2"]);
        });
    });

    describe("ancestors outside of the root", () => {
        it("should reject ancestor matches crossing the root boundary", () => {
            // `.outer` is an ancestor of the root and must not match.
            expect(
                ids(CSSselect.selectAll(":not(:scope) span", root)),
            ).toStrictEqual([]);
            expect(
                ids(CSSselect.selectAll(".outer span", root)),
            ).toStrictEqual([]);
            expect(ids(CSSselect.selectAll("* > span", root))).toStrictEqual(
                [],
            );
        });

        it("should still cross the boundary with `relativeSelector: false`", () => {
            expect(
                ids(
                    CSSselect.selectAll(".outer span", root, {
                        relativeSelector: false,
                    }),
                ),
            ).toStrictEqual(["s1", "s2"]);
        });
    });

    describe("overlapping roots", () => {
        it("should match every root with `:scope`, independently", () => {
            expect(
                ids(CSSselect.selectAll(":scope", [outer, root])),
            ).toStrictEqual(["outer", "root"]);
            expect(
                ids(CSSselect.selectAll(":scope", [root, outer])),
            ).toStrictEqual(["outer", "root"]);
        });

        it("should return shared descendants only once", () => {
            expect(
                ids(CSSselect.selectAll("span", [outer, root])),
            ).toStrictEqual(["s1", "s2"]);
            expect(
                ids(CSSselect.selectAll("span", [root, outer])),
            ).toStrictEqual(["s1", "s2"]);
            expect(
                ids(CSSselect.selectAll(":scope span", [outer, root])),
            ).toStrictEqual(["s1", "s2"]);
        });

        it("should treat nested roots as independent boundaries", () => {
            // `root` is a `<div>` strictly below the `outer` root.
            expect(
                ids(CSSselect.selectAll("div span", [outer, root])),
            ).toStrictEqual(["s1", "s2"]);
            // A nested root is still a valid child of an outer root.
            expect(
                ids(CSSselect.selectAll("> .root", [outer, root])),
            ).toStrictEqual(["root"]);
            // Nothing above the outermost root may match.
            expect(
                ids(CSSselect.selectAll(":not(:scope) span", [outer, root])),
            ).toStrictEqual([]);
        });
    });
});
