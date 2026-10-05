/**
 * Example: explicitly registered pseudo-class extensions.
 *
 * Run with: npm run example:pseudo-extensions
 * (or `npm run build && node examples/pseudo-extensions.mjs`)
 */
import { parseDocument } from "htmlparser2";
import { compile, selectAll } from "../dist/index.js";

const document = parseDocument(
    `<main>
        <article><h2>Short</h2><p>hi</p></article>
        <article><h2>Long</h2><p>a much longer paragraph of text</p></article>
        <aside><p>loose</p></aside>
    </main>`,
);

const pseudoExtensions = {
    /*
     * Example 1: a pure extension with a required string argument.
     * Pure results only depend on the element, so they may be cached.
     */
    "min-text-length": {
        argument: "required",
        argumentType: "string",
        pure: true,
        match: (element, argument, options) =>
            options.adapter.getText(element).trim().length >=
            Number(argument),
    },
    /*
     * Example 2: an extension whose argument is a nested selector,
     * still parsed by css-select's own parser.
     */
    "parent-is": {
        argument: "required",
        argumentType: "selector",
        match: (element, argument, options) => {
            const parent = options.adapter.getParent(element);
            return (
                parent != null &&
                options.adapter.isTag(parent) &&
                argument(parent)
            );
        },
    },
};

const options = { pseudoExtensions };

// Missing required arguments are rejected at compile time, with a position.
try {
    compile("p:min-text-length", options);
} catch (error) {
    console.log(`Compile-time error: ${error.message}`);
}

// Legal arguments compile without touching the DOM, and only then query.
const longParagraphs = selectAll("p:min-text-length(10)", document, options);
console.log(
    "Paragraphs with at least 10 characters of text:",
    longParagraphs.length,
);

const articleParagraphs = selectAll(
    "p:parent-is(article)",
    document,
    options,
);
console.log("Paragraphs inside an <article>:", articleParagraphs.length);
